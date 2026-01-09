import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Notice, Spinner } from '@wordpress/components';

export default function Import() {
	const [file, setFile] = useState(null);
	const [isUploading, setIsUploading] = useState(false);
	const [results, setResults] = useState(null);
	const [error, setError] = useState(null);

	const handleFileChange = (event) => {
		const selectedFile = event.target.files[0];
		if (selectedFile) {
			setFile(selectedFile);
			setResults(null);
			setError(null);
		}
	};

	const handleImport = async () => {
		if (!file) {
			setError(__('Please select a file to import.', 'fair-audience'));
			return;
		}

		setIsUploading(true);
		setError(null);
		setResults(null);

		try {
			const formData = new FormData();
			formData.append('file', file);

			const response = await apiFetch({
				path: '/fair-audience/v1/import/entradium',
				method: 'POST',
				body: formData,
			});

			setResults(response);
			setFile(null);
			// Reset file input
			document.getElementById('file-input').value = '';
		} catch (err) {
			setError(
				err.message ||
					__('Import failed. Please try again.', 'fair-audience')
			);
		} finally {
			setIsUploading(false);
		}
	};

	return (
		<div className="wrap">
			<h1>{__('Import Participants', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<h2>{__('Import from Entradium', 'fair-audience')}</h2>
					<p>
						{__(
							'Upload an Entradium Excel file (.xlsx) to import participants. The file must contain columns: Nombre, Apellidos, and Email.',
							'fair-audience'
						)}
					</p>

					<div style={{ marginTop: '20px' }}>
						<input
							id="file-input"
							type="file"
							accept=".xlsx,.xls"
							onChange={handleFileChange}
							disabled={isUploading}
						/>
					</div>

					{file && (
						<div style={{ marginTop: '10px' }}>
							<p>
								<strong>
									{__('Selected file:', 'fair-audience')}
								</strong>{' '}
								{file.name}
							</p>
						</div>
					)}

					<div style={{ marginTop: '20px' }}>
						<Button
							isPrimary
							onClick={handleImport}
							disabled={!file || isUploading}
						>
							{isUploading
								? __('Importing...', 'fair-audience')
								: __('Import', 'fair-audience')}
						</Button>
					</div>

					{isUploading && (
						<div style={{ marginTop: '20px' }}>
							<Spinner />
						</div>
					)}

					{error && (
						<div style={{ marginTop: '20px' }}>
							<Notice status="error" isDismissible={false}>
								{error}
							</Notice>
						</div>
					)}

					{results && (
						<div style={{ marginTop: '20px' }}>
							<Notice status="success" isDismissible={false}>
								<p>
									<strong>
										{__('Import Complete', 'fair-audience')}
									</strong>
								</p>
								<ul>
									<li>
										{__('Imported:', 'fair-audience')}{' '}
										{results.imported}
									</li>
									<li>
										{__(
											'Skipped (already exists):',
											'fair-audience'
										)}{' '}
										{results.skipped}
									</li>
								</ul>
							</Notice>

							{results.errors && results.errors.length > 0 && (
								<Notice
									status="warning"
									isDismissible={false}
									style={{ marginTop: '10px' }}
								>
									<p>
										<strong>
											{__('Errors:', 'fair-audience')}
										</strong>
									</p>
									<ul>
										{results.errors.map((err, index) => (
											<li key={index}>{err}</li>
										))}
									</ul>
								</Notice>
							)}
						</div>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
