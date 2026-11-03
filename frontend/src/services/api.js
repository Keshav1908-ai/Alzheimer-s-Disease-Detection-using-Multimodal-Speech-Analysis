import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const apiService = {
  // Health check
  healthCheck: async () => {
    const response = await api.get('/health');
    return response.data;
  },

  // Upload audio
  uploadAudio: async (file) => {
    const formData = new FormData();
    formData.append('audio', file, file.name);

    const response = await api.post('/upload', formData, {
      headers: {
        'Content-Type': undefined,
      },
    });
    return response.data;
  },

  // Process audio
  processAudio: async (audioId) => {
    const response = await api.post(`/process/${audioId}`);
    return response.data;
  },

  // Get history
  getHistory: async (limit = 50) => {
    const response = await api.get(`/history?limit=${limit}`);
    return response.data;
  },

  // Get prediction
  getPrediction: async (audioId) => {
    const response = await api.get(`/prediction/${audioId}`);
    return response.data;
  },

  // Get model info
  getModelInfo: async () => {
    const response = await api.get('/model/info');
    return response.data;
  },

  // Retrain model
  retrainModel: async () => {
    const response = await api.post('/model/retrain');
    return response.data;
  },

  // Reset model
  resetModel: async () => {
    const response = await api.post('/model/reset');
    return response.data;
  },

  // Update threshold
  updateThreshold: async (threshold) => {
    const response = await api.post('/model/threshold', { threshold });
    return response.data;
  },

  // Get stats
  getStats: async () => {
    const response = await api.get('/stats');
    return response.data;
  },
};

export default apiService;
