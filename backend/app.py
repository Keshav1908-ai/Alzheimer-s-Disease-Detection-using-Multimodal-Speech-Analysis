from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import time
from werkzeug.utils import secure_filename

# Import services
from services.preprocessing_service import PreprocessingService
from services.feature_extraction_service import FeatureExtractionService
from services.nlp_service import NLPService
from services.model_service import ModelService
from services.prediction_service import PredictionService
from database.db_service import DatabaseService

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = 'data/audio'
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'flac', 'webm', 'mp4', 'm4a'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Initialize services
db_service = DatabaseService()
preprocessing_service = PreprocessingService()
feature_extraction_service = FeatureExtractionService()
nlp_service = NLPService()
model_service = ModelService()
prediction_service = PredictionService(model_service)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ============= API Routes =============

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Early Alzheimer Detection System API is running',
        'version': '1.0.0'
    })

@app.route('/api/upload', methods=['POST'])
def upload_audio():
    """Upload audio file"""
    try:
        # Check if file is present
        if 'audio' not in request.files:
            return jsonify({'success': False, 'error': 'No audio file provided'}), 400

        file = request.files['audio']

        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        if not allowed_file(file.filename):
            return jsonify({'success': False, 'error': 'Invalid file type'}), 400

        # Save file
        filename = secure_filename(file.filename)
        timestamp = int(time.time())
        filename = f"{timestamp}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Get audio info
        audio_info = preprocessing_service.get_audio_info(filepath)

        if not audio_info['success']:
            return jsonify({'success': False, 'error': audio_info['error']}), 400

        # Create audio record in database
        user_id = 1  # Default user for demo
        audio_id = db_service.create_audio_record(
            user_id=user_id,
            filename=filename,
            duration=audio_info['duration'],
            file_path=filepath
        )

        return jsonify({
            'success': True,
            'audio_id': audio_id,
            'filename': filename,
            'duration': audio_info['duration'],
            'filepath': filepath
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/process/<int:audio_id>', methods=['POST'])
def process_audio(audio_id):
    """Process audio through complete pipeline"""
    try:
        # Get audio file path from database
        conn = db_service.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT file_path FROM audio_records WHERE id = ?', (audio_id,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return jsonify({'success': False, 'error': 'Audio not found'}), 404

        audio_path = row['file_path']

        # Step 1: Preprocessing
        preprocess_result = preprocessing_service.preprocess_audio(audio_path)

        if not preprocess_result['success']:
            return jsonify({'success': False, 'error': preprocess_result['error']}), 500

        # Step 2: Feature Extraction
        acoustic_features = feature_extraction_service.extract_features(
            preprocess_result['audio'],
            preprocess_result['sample_rate']
        )

        # Step 3: NLP Processing
        nlp_result = nlp_service.process_audio(audio_path)

        # Step 4: Combine features for database
        combined_features = {
            'mfcc_mean': acoustic_features['mfcc_mean'],
            'speech_rate': acoustic_features['speech_rate'],
            'pause_duration': acoustic_features['pause_duration'],
            'zcr': acoustic_features['zcr_mean'],
            'chroma_mean': acoustic_features['chroma_mean'],
            'lexical_diversity': nlp_result['features']['lexical_diversity'],
            'repetition_score': nlp_result['features']['repetition_score'],
            'hesitation_count': nlp_result['features']['hesitation_count'],
            'complexity_score': nlp_result['features']['complexity_score']
        }

        # Save features to database
        feature_id = db_service.save_features(audio_id, combined_features)

        # Step 5: Make Prediction
        prediction = prediction_service.make_prediction(
            acoustic_features,
            nlp_result['features']
        )

        # Save prediction to database
        prediction_id = db_service.save_prediction(audio_id, feature_id, prediction)

        # Prepare response
        response = {
            'success': True,
            'audio_id': audio_id,
            'preprocessing': {
                'status': 'complete',
                'duration': preprocess_result['duration']
            },
            'acoustic_features': feature_extraction_service.get_feature_summary(acoustic_features),
            'acoustic_features_raw': {
                'speech_rate': acoustic_features['speech_rate'],
                'pause_duration': acoustic_features['pause_duration'],
                'zcr_mean': acoustic_features['zcr_mean'],
                'spectral_centroid': acoustic_features['spectral_centroid']
            },
            'nlp': {
                'transcript': nlp_result['transcript'],
                'features': nlp_service.get_feature_summary(nlp_result['features']),
                'features_raw': nlp_result['features']
            },
            'prediction': {
                'prediction_id': prediction_id,
                'risk_level': prediction['risk_level'],
                'confidence': prediction['confidence'],
                'confidence_level': prediction['confidence_level'],
                'probabilities': prediction['probabilities'],
                'recommendations': prediction['recommendations'],
                'risk_factors': prediction['risk_factors']
            }
        }

        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Get prediction history"""
    try:
        limit = request.args.get('limit', 50, type=int)
        predictions = db_service.get_all_predictions(limit)

        return jsonify({
            'success': True,
            'count': len(predictions),
            'predictions': predictions
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/prediction/<int:audio_id>', methods=['GET'])
def get_prediction(audio_id):
    """Get prediction for specific audio"""
    try:
        prediction = db_service.get_prediction_by_audio_id(audio_id)

        if not prediction:
            return jsonify({'success': False, 'error': 'Prediction not found'}), 404

        return jsonify({
            'success': True,
            'prediction': prediction
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/model/info', methods=['GET'])
def get_model_info():
    """Get model information"""
    try:
        model_info = model_service.get_model_info()
        architecture = model_service.get_architecture()
        diagram = model_service.get_architecture_diagram()
        db_metadata = db_service.get_model_metadata()

        return jsonify({
            'success': True,
            'model': model_info,
            'architecture': architecture,
            'diagram': diagram,
            'metadata': db_metadata
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/model/retrain', methods=['POST'])
def retrain_model():
    """Mock model retraining"""
    try:
        retrain_result = model_service.retrain()

        # Update model metadata
        db_service.update_model_metadata(
            accuracy=retrain_result['metrics']['val_accuracy']
        )

        return jsonify({
            'success': True,
            'message': 'Model retrained successfully',
            'metrics': retrain_result['metrics']
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/model/reset', methods=['POST'])
def reset_model():
    """Reset model to default state"""
    try:
        db_service.reset_model()

        return jsonify({
            'success': True,
            'message': 'Model reset to default state'
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/model/threshold', methods=['POST'])
def update_threshold():
    """Update confidence threshold"""
    try:
        data = request.get_json()
        threshold = data.get('threshold', 0.7)

        # Validate threshold
        if not 0 <= threshold <= 1:
            return jsonify({'success': False, 'error': 'Threshold must be between 0 and 1'}), 400

        # Update in database
        db_service.update_model_metadata(threshold=threshold)

        # Update in prediction service
        prediction_service.set_threshold(threshold)

        return jsonify({
            'success': True,
            'threshold': threshold,
            'message': 'Threshold updated successfully'
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get system statistics"""
    try:
        conn = db_service.get_connection()
        cursor = conn.cursor()

        # Count total predictions
        cursor.execute('SELECT COUNT(*) as count FROM predictions')
        total_predictions = cursor.fetchone()['count']

        # Count by risk level
        cursor.execute('''
            SELECT risk_level, COUNT(*) as count
            FROM predictions
            GROUP BY risk_level
        ''')
        risk_distribution = {row['risk_level']: row['count'] for row in cursor.fetchall()}

        # Average confidence
        cursor.execute('SELECT AVG(confidence) as avg_conf FROM predictions')
        avg_confidence = cursor.fetchone()['avg_conf'] or 0

        conn.close()

        return jsonify({
            'success': True,
            'stats': {
                'total_predictions': total_predictions,
                'risk_distribution': risk_distribution,
                'average_confidence': round(avg_confidence, 4)
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'success': False, 'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'success': False, 'error': 'Internal server error'}), 500

if __name__ == '__main__':
    print("Starting Early Alzheimer Detection System API...")
    print("API running on http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
