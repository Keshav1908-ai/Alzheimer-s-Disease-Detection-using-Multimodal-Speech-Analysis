import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiService from '../services/api';

const Upload = () => {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Recording states
  const [mode, setMode] = useState('upload'); // 'upload' or 'record'
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [recordingMeta, setRecordingMeta] = useState({ ext: 'webm', mime: 'audio/webm' });
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioURL, setAudioURL] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
    };
  }, [audioURL]);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const allowedExtensions = ['wav', 'mp3', 'ogg', 'flac', 'webm', 'mp4', 'm4a'];
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (!extension || !allowedExtensions.includes(extension)) {
      setSelectedFile(null);
      setError(`Unsupported file type "${extension || 'unknown'}". Please select a WAV, MP3, OGG, FLAC, WebM, MP4, or M4A file.`);
      event.target.value = '';
      return;
    }

    if (file.size > 16 * 1024 * 1024) {
      setSelectedFile(null);
      setError('The audio file exceeds the 16 MB upload limit. Please choose a smaller file.');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
    setError(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine supported MIME type
      let mimeType = 'audio/webm';
      let fileExtension = 'webm';
      
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
        fileExtension = 'ogg';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
        fileExtension = 'mp4';
      } else if (MediaRecorder.isTypeSupported('audio/mpeg')) {
        mimeType = 'audio/mpeg';
        fileExtension = 'mp3';
      } else {
        // Fallback to default
        console.warn('No supported audio MIME type found, using default');
      }

      // Create MediaRecorder with supported MIME type
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setRecordedBlob(audioBlob);
        setRecordingMeta({ ext: fileExtension, mime: mimeType });
        setIsFinalizingRecording(false);
        const url = URL.createObjectURL(audioBlob);
        setAudioURL(url);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Failed to access microphone. Please grant permission and try again.');
      console.error('Error accessing microphone:', err);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setIsFinalizingRecording(true);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      clearInterval(timerRef.current);
    }
  };

  const resetRecording = () => {
    setRecordedBlob(null);
    setRecordingMeta({ ext: 'webm', mime: 'audio/webm' });
    setIsFinalizingRecording(false);
    setRecordingTime(0);
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }
    setAudioURL(null);
    audioChunksRef.current = [];
  };

  const handleUpload = async () => {
    let fileToUpload = selectedFile;

    // If in record mode, convert the finished recording blob to a file
    if (mode === 'record') {
      if (!recordedBlob) {
        setError('Recording is not ready yet. Please wait for the recording to finish, then try again.');
        return;
      }
      if (recordedBlob.size === 0) {
        setError('The recording is empty. Please record audio again and stop after speaking.');
        return;
      }

      const timestamp = Date.now();
      const mimeType = recordedBlob.type || recordingMeta.mime || 'audio/webm';
      const extension = recordingMeta.ext || (mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') ? 'mp3' : 'webm');
      fileToUpload = new File([recordedBlob], `recording_${timestamp}.${extension}`, {
        type: mimeType,
      });
    }

    if (!fileToUpload) {
      setError(mode === 'record' ? 'Please record audio first' : 'Please select an audio file');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const response = await apiService.uploadAudio(fileToUpload);

      if (response.success) {
        // Navigate to processing page
        navigate(`/processing/${response.audio_id}`);
      } else {
        setError(response.error || 'Upload failed');
      }
    } catch (err) {
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.code === 'ERR_NETWORK') {
        setError('Cannot connect to the backend server at http://localhost:5000. Please make sure it is running.');
      } else {
        setError(err.message || 'Failed to upload audio file');
      }
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card">
        <h2 className="text-3xl font-bold mb-2">Upload Audio Sample</h2>
        <p className="text-gray-600 mb-6">
          Upload a speech audio file or record your voice for Alzheimer's risk assessment. Recommended: 30-60 seconds of clear speech.
        </p>

        {/* Mode Selection Tabs */}
        <div className="flex space-x-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => {
              setMode('upload');
              setError(null);
            }}
            className={`px-6 py-3 font-medium transition-colors border-b-2 ${
              mode === 'upload'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Upload File
          </button>
          <button
            onClick={() => {
              setMode('record');
              setError(null);
            }}
            className={`px-6 py-3 font-medium transition-colors border-b-2 ${
              mode === 'record'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Record Audio
          </button>
        </div>

        {/* Upload Mode */}
        {mode === 'upload' && (
          <>
            {/* File Upload Area */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center mb-6">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 mb-4"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="mb-4">
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer bg-primary text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors inline-block"
                >
                  Choose Audio File
                </label>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".wav,.mp3,.ogg,.flac,.webm,.mp4,.m4a"
                  onChange={handleFileSelect}
                />
              </div>
              <p className="text-sm text-gray-500">
                Supported formats: WAV, MP3, OGG, FLAC, WebM, MP4 (Max 16MB)
              </p>
            </div>

            {/* Selected File Info */}
            {selectedFile && (
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <h3 className="font-bold mb-3">Selected File:</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-gray-600">{formatFileSize(selectedFile.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Record Mode */}
        {mode === 'record' && (
          <>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
              {!isRecording && !recordedBlob && (
                <>
                  <svg
                    className="mx-auto h-16 w-16 text-gray-400 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold mb-2">Ready to Record</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Click the button below to start recording your voice
                  </p>
                  <button
                    onClick={startRecording}
                    className="bg-red-500 text-white px-8 py-3 rounded-lg hover:bg-red-600 transition-colors inline-flex items-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="6" />
                    </svg>
                    Start Recording
                  </button>
                </>
              )}

              {isRecording && (
                <>
                  <div className="mb-6">
                    <div className="flex justify-center items-center space-x-2 mb-4">
                      <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="text-lg font-semibold text-red-500">
                        {isPaused ? 'Paused' : 'Recording...'}
                      </span>
                    </div>
                    <div className="text-4xl font-mono font-bold text-gray-700 mb-1">
                      {formatTime(recordingTime)}
                    </div>
                    <p className="text-sm text-gray-500">Recommended: 30-60 seconds</p>
                  </div>

                  {/* Animated waveform */}
                  {!isPaused && (
                    <div className="flex justify-center space-x-1 mb-6">
                      {[...Array(20)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-primary rounded-full animate-pulse"
                          style={{
                            height: `${Math.random() * 40 + 20}px`,
                            animationDelay: `${i * 0.1}s`,
                          }}
                        ></div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-center space-x-4">
                    {!isPaused ? (
                      <button
                        onClick={pauseRecording}
                        className="bg-yellow-500 text-white px-6 py-2 rounded-lg hover:bg-yellow-600 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M5 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4zM11 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={resumeRecording}
                        className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={stopRecording}
                      className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <rect x="4" y="4" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                  </div>
                </>
              )}

              {recordedBlob && !isRecording && (
                <>
                  <svg
                    className="mx-auto h-16 w-16 text-green-500 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold mb-2 text-green-600">Recording Complete!</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Duration: {formatTime(recordingTime)} | Size: {formatFileSize(recordedBlob.size)}
                  </p>

                  {/* Audio Playback */}
                  {audioURL && (
                    <div className="mb-6">
                      <audio controls src={audioURL} className="w-full mb-4">
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  )}

                  <button
                    onClick={resetRecording}
                    className="text-primary hover:text-blue-700 font-medium"
                  >
                    Record Again
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Upload Button */}
        <div className="flex space-x-4">
          <button
            onClick={handleUpload}
            disabled={
              (mode === 'upload' && !selectedFile) ||
              (mode === 'record' && !recordedBlob) ||
              (mode === 'record' && isFinalizingRecording) ||
              uploading ||
              isRecording
            }
            className={`btn-primary flex-1 ${
              (mode === 'upload' && !selectedFile) ||
              (mode === 'record' && !recordedBlob) ||
              (mode === 'record' && isFinalizingRecording) ||
              uploading ||
              isRecording
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Uploading...
              </div>
            ) : isFinalizingRecording ? (
              'Finalizing Recording...'
            ) : (
              'Upload & Analyze'
            )}
          </button>
          <button
            onClick={() => navigate('/')}
            className="btn-secondary"
            disabled={uploading || isRecording}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="card bg-blue-50">
        <h3 className="text-xl font-bold mb-3">
          {mode === 'upload' ? 'Recording Tips' : 'How to Record'}
        </h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Record in a quiet environment with minimal background noise</span>
          </li>
          <li className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Speak naturally - describe your day, tell a story, or answer questions</span>
          </li>
          <li className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Recommended duration: 30-60 seconds for best results</span>
          </li>
          <li className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Use good quality microphone for clear audio capture</span>
          </li>
          {mode === 'record' && (
            <li className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Allow microphone access when prompted by your browser</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default Upload;
