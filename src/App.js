import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://cybergen-report.onrender.com';

// Helper function to format error messages
const formatErrorMessage = (error) => {
  if (typeof error === 'string') return error;
  if (error?.detail) {
    if (Array.isArray(error.detail)) {
      return error.detail.map(err => err.msg || err.message || String(err)).join(', ');
    }
    return String(error.detail);
  }
  if (error?.message) return error.message;
  if (Array.isArray(error)) return error.map(String).join(', ');
  if (typeof error === 'object') return 'An error occurred while processing your request';
  return String(error);
};

function App() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [displayData, setDisplayData] = useState({
    fileInfo: [],
    downloadButtons: [],
    showDownloadAll: false
  });

  // Handle file selection
  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files);
    
    // Validate files
    const invalidFiles = selectedFiles.filter(
      file => !file.name.toLowerCase().match(/\.(docx|pdf)$/)
    );

    if (invalidFiles.length > 0) {
      setError(`Invalid file type(s): ${invalidFiles.map(f => f.name).join(', ')}. Only DOCX and PDF files are allowed.`);
      setFiles([]);
      return;
    }

    // Validate file sizes
    const oversizedFiles = selectedFiles.filter(
      file => file.size > 10 * 1024 * 1024
    );

    if (oversizedFiles.length > 0) {
      setError(`File(s) too large: ${oversizedFiles.map(f => f.name).join(', ')}. Maximum size is 10MB per file.`);
      setFiles([]);
      return;
    }

    setFiles(selectedFiles);
    setError(null);
  };

  // Handle file upload
  const handleSubmit = async (event) => {
    event.preventDefault();
    
    if (files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setJobId(null);
      setJobStatus(null);
      setProgress(0);

      // Create form data
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      const response = await axios.post(`${API_URL}/upload-files/`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data?.job_id) {
        setJobId(response.data.job_id);
        setProgress(25);
      } else {
        throw new Error('No job ID received');
      }
    } catch (err) {
      console.error('Upload error:', err.response?.data || err);
      setError(formatErrorMessage(err.response?.data || err));
    } finally {
      setLoading(false);
    }
  };

  // Status polling with interval
  useEffect(() => {
    let intervalId = null;

    const checkStatus = async () => {
      if (!jobId) return;

      try {
        const response = await axios.get(`${API_URL}/job-status/${jobId}`);
        setJobStatus(response.data);
        
        const status = response.data?.status?.toLowerCase();
        switch (status) {
          case 'pending':
            setProgress(25);
            break;
          case 'processing':
            setProgress(50);
            break;
          case 'completed':
            setProgress(100);
            clearInterval(intervalId);
            break;
          case 'failed':
            setError(response.data.error || 'Processing failed');
            setProgress(0);
            clearInterval(intervalId);
            break;
          default:
            console.warn('Unknown status:', status);
        }
      } catch (err) {
        console.error('Status check error:', err);
        setError(formatErrorMessage(err));
        clearInterval(intervalId);
      }
    };

    if (jobId) {
      // Initial check
      checkStatus();
      // Start polling
      intervalId = setInterval(checkStatus, 2000);
    }

    // Cleanup on unmount or when jobId changes
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [jobId]);

  // Display Data Handler - Updates UI based on files and job status
  useEffect(() => {
    if (!files.length && !jobStatus) return;

    const fileInfo = files.map((file, index) => ({
      id: index,
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2)
    }));

    let downloadButtons = [];
    let showDownloadAll = false;

    if (jobStatus?.status?.toLowerCase() === 'completed' && jobStatus.output_files) {
      downloadButtons = jobStatus.output_files.map((filename, index) => ({
        id: index,
        filename,
        label: jobStatus.output_files.length > 1 ? `File ${index + 1}` : 'Document'
      }));
      showDownloadAll = jobStatus.output_files.length > 1;
    }

    setDisplayData({
      fileInfo,
      downloadButtons,
      showDownloadAll
    });
  }, [files, jobStatus]);

  // Download file helper function
  const downloadFile = async (jobId, filename = null) => {
    try {
      const url = filename 
        ? `${API_URL}/download/${jobId}?filename=${encodeURIComponent(filename)}`
        : `${API_URL}/download/${jobId}`;
        
      const response = await fetch(url);
      
      if (response.headers.get('content-type') === 'application/json') {
        // Got a list of files
        const data = await response.json();
        return {
          type: 'file_list',
          files: data.files,
          downloadUrls: data.download_urls
        };
      } else {
        // Got a file download
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename || response.headers.get('content-disposition').split('filename=')[1];
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        return {
          type: 'download',
          success: true
        };
      }
    } catch (error) {
      console.error('Download failed:', error);
      throw error;
    }
  };

  // Handle file download
  const handleDownload = async (filename = null) => {
    if (!jobId) return;
    
    try {
      const result = await downloadFile(jobId, filename);
      if (result.type === 'file_list') {
        // Update the display data with the file list
        const downloadButtons = result.files.map((file, index) => ({
          id: index,
          filename: file,
          label: result.files.length > 1 ? `File ${index + 1}` : 'Document',
          url: result.downloadUrls[index]
        }));
        
        setDisplayData(prev => ({
          ...prev,
          downloadButtons,
          showDownloadAll: result.files.length > 1
        }));
      } else {
        console.log('File downloaded successfully');
      }
    } catch (err) {
      console.error('Download error:', err);
      setError('Error downloading file');
    }
  };

  // Handle download all files
  const handleDownloadAll = async () => {
    if (!jobId) return;
    
    try {
      const url = `${API_URL}/download-all/${jobId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to download ZIP file');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      
      // Get filename from content-disposition or use default
      const contentDisposition = response.headers.get('content-disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]
        : 'processed_files.zip';
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      console.log('ZIP file downloaded successfully');
    } catch (err) {
      console.error('Download error:', err);
      setError('Error downloading ZIP file');
    }
  };

  return (
    <div className="app">
      <header>
        <h1 className="text-2xl font-bold">Document Processor</h1>
        <p>Upload DOCX or PDF files for processing</p>
      </header>

      <main>
        <form onSubmit={handleSubmit}>
          <div className="file-input">
            <input
              type="file"
              onChange={handleFileChange}
              accept=".docx,.pdf"
              multiple
              disabled={loading}
            />
          </div>

          {displayData.fileInfo.length > 0 && (
            <div className="file-info">
              <h3>Selected Files:</h3>
              {displayData.fileInfo.map(file => (
                <p key={file.id}>
                  {file.name} ({file.size} MB)
                </p>
              ))}
            </div>
          )}

          <button 
            type="submit" 
            disabled={files.length === 0 || loading}
            className="submit-button"
          >
            {loading ? 'Uploading...' : 'Process Documents'}
          </button>
        </form>

        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {jobId && (
          <div className="status">
            <h2>Processing Status</h2>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p>Status: {jobStatus?.status || 'Initializing...'}</p>

            <div className="processing-files-card">
              <h3>Files Status</h3>
              <div className="files-list">
                {jobStatus?.output_files ? (
                  // Show processed files when available
                  jobStatus.output_files.map((filename, index) => (
                    <div key={index} className="file-status-item">
                      <span className="file-name">{filename}</span>
                      <span className="file-status">
                        {jobStatus.status?.toLowerCase() === 'completed' ? (
                          <button
                            onClick={() => handleDownload(filename)}
                            className="download-link-button"
                          >
                            Download
                          </button>
                        ) : (
                          <span className="status-badge">
                            {jobStatus.status || 'Pending'}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  // Show original files while processing
                  files.map((file, index) => (
                    <div key={index} className="file-status-item">
                      <span className="file-name">{file.name}</span>
                      <span className="file-status">
                        <span className="status-badge">
                          {jobStatus?.status || 'Pending'}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {jobStatus?.status?.toLowerCase() === 'completed' && (
              <div className="download-section">
                {jobStatus.output_files && jobStatus.output_files.length > 1 && (
                  <button
                    onClick={handleDownloadAll}
                    className="download-all-button"
                  >
                    Download All
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer>
        <p>Maximum file size: 10MB | Supported formats: DOCX, PDF</p>
      </footer>
    </div>
  );
}

export default App;

// Add CSS styles
const styles = `
  .processing-files-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .files-list {
    margin-top: 12px;
  }

  .file-status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #e9ecef;
  }

  .file-status-item:last-child {
    border-bottom: none;
  }

  .file-name {
    font-size: 14px;
    color: #495057;
    flex: 1;
    margin-right: 16px;
    word-break: break-all;
  }

  .status-badge {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 12px;
    background: #e9ecef;
    color: #495057;
    text-transform: capitalize;
  }

  .download-link-button {
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 4px;
    background: #007bff;
    color: white;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .download-link-button:hover {
    background: #0056b3;
  }
`;

// Add style tag to document head
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);
