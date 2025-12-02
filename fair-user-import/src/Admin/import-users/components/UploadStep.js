/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Upload Step Component - CSV file upload with drag-drop
 *
 * @param {Object} props Component props
 * @param {Function} props.onComplete Callback when upload is complete
 * @return {JSX.Element} The Upload Step component
 */
export default function UploadStep({ onComplete }) {
	const [file, setFile] = useState(null);
	const [isUploading, setIsUploading] = useState(false);
	const [error, setError] = useState(null);
	const [isDragging, setIsDragging] = useState(false);
	const [preview, setPreview] = useState(null);

	const validateFile = (selectedFile) => {
		// Check file type
		if (
			selectedFile.type !== 'text/csv' &&
			!selectedFile.name.endsWith('.csv')
		) {
			return __('Please upload a CSV file (.csv)', 'fair-user-import');
		}

		// Check file size (max 10MB)
		const maxSize = 10 * 1024 * 1024;
		if (selectedFile.size > maxSize) {
			return __('File size must be less than 10MB', 'fair-user-import');
		}

		return null;
	};

	const handleFileSelect = (selectedFile) => {
		const validationError = validateFile(selectedFile);
		if (validationError) {
			setError(validationError);
			setFile(null);
			return;
		}

		setFile(selectedFile);
		setError(null);
	};

	const handleFileInputChange = (event) => {
		const selectedFile = event.target.files?.[0];
		if (selectedFile) {
			handleFileSelect(selectedFile);
		}
	};

	const handleDragOver = (event) => {
		event.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = () => {
		setIsDragging(false);
	};

	const handleDrop = (event) => {
		event.preventDefault();
		setIsDragging(false);

		const droppedFile = event.dataTransfer.files?.[0];
		if (droppedFile) {
			handleFileSelect(droppedFile);
		}
	};

	const handleUpload = async () => {
		if (!file) {
			return;
		}

		setIsUploading(true);
		setError(null);

		try {
			const formData = new FormData();
			formData.append('file', file);

			const response = await apiFetch({
				path: '/fair-user-import/v1/import-users/upload',
				method: 'POST',
				body: formData,
			});

			if (response.success) {
				// Store preview data and parsed rows
				setPreview({
					...response.data.preview,
					parsedData: response.data.rows,
				});
			} else {
				setError(
					response.message ||
						__('Failed to upload file', 'fair-user-import')
				);
			}
		} catch (err) {
			setError(
				err.message || __('Failed to upload file', 'fair-user-import')
			);
		} finally {
			setIsUploading(false);
		}
	};

	const handleContinue = () => {
		if (preview && preview.parsedData) {
			onComplete(file, preview.parsedData);
		}
	};

	return (
		<div className="fair-membership-upload-step">
			<p>
				{__(
					'Upload a CSV file containing user data. The file should have column headers in the first row.',
					'fair-user-import'
				)}
			</p>

			<div
				className={`fair-membership-file-dropzone ${
					isDragging ? 'dragging' : ''
				}`}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				<div className="dropzone-content">
					<span className="dashicons dashicons-upload"></span>
					<p>
						{__(
							'Drag and drop a CSV file here, or click to select',
							'fair-user-import'
						)}
					</p>
					<input
						type="file"
						accept=".csv,text/csv"
						onChange={handleFileInputChange}
						disabled={isUploading}
						style={{
							position: 'absolute',
							top: 0,
							left: 0,
							width: '100%',
							height: '100%',
							opacity: 0,
							cursor: 'pointer',
						}}
					/>
				</div>
			</div>

			{file && (
				<div className="fair-membership-file-info">
					<p>
						<strong>
							{__('Selected file:', 'fair-user-import')}
						</strong>{' '}
						{file.name} ({Math.round(file.size / 1024)} KB)
					</p>
				</div>
			)}

			{error && (
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			)}

			{preview && (
				<div className="fair-membership-upload-preview">
					<h3>{__('Preview (first 5 rows)', 'fair-user-import')}</h3>
					<table className="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								{preview.columns.map((col, idx) => (
									<th key={idx}>{col}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{preview.rows.map((row, idx) => (
								<tr key={idx}>
									{preview.columns.map((col, colIdx) => (
										<td key={colIdx}>{row[col]}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					<p>
						{__('Total rows:', 'fair-user-import')} {preview.total}
					</p>
				</div>
			)}

			<div className="fair-membership-upload-actions">
				{!preview ? (
					<button
						type="button"
						className="button button-primary"
						onClick={handleUpload}
						disabled={!file || isUploading}
					>
						{isUploading
							? __('Uploading...', 'fair-user-import')
							: __('Upload & Parse CSV', 'fair-user-import')}
					</button>
				) : (
					<button
						type="button"
						className="button button-primary"
						onClick={handleContinue}
					>
						{__('Continue to Field Mapping', 'fair-user-import')}
					</button>
				)}
			</div>

			<style>{`
				.fair-membership-file-dropzone {
					border: 2px dashed #ccc;
					border-radius: 4px;
					padding: 40px;
					text-align: center;
					position: relative;
					margin: 20px 0;
					background: #fafafa;
					transition: all 0.3s;
				}
				.fair-membership-file-dropzone.dragging {
					border-color: #2271b1;
					background: #f0f6fc;
				}
				.fair-membership-file-dropzone .dashicons {
					font-size: 48px;
					width: 48px;
					height: 48px;
					color: #2271b1;
				}
				.fair-membership-file-info {
					margin: 20px 0;
					padding: 10px;
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
				}
				.fair-membership-upload-preview {
					margin: 20px 0;
				}
				.fair-membership-upload-preview table {
					margin-top: 10px;
				}
				.fair-membership-upload-actions {
					margin-top: 20px;
				}
			`}</style>
		</div>
	);
}
