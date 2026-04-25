import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Notice,
	Spinner,
	SelectControl,
} from '@wordpress/components';

export default function KitImport() {
	const [file, setFile] = useState(null);
	const [isUploading, setIsUploading] = useState(false);
	const [results, setResults] = useState(null);
	const [error, setError] = useState(null);
	const [emailProfile, setEmailProfile] = useState('minimal');
	const [groups, setGroups] = useState([]);
	const [selectedGroupId, setSelectedGroupId] = useState('');
	const [isLoadingGroups, setIsLoadingGroups] = useState(true);

	useEffect(() => {
		apiFetch({ path: '/fair-audience/v1/groups' })
			.then((data) => {
				setGroups(data);
				setIsLoadingGroups(false);
			})
			.catch(() => {
				setIsLoadingGroups(false);
			});
	}, []);

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
			formData.append('email_profile', emailProfile);
			if (selectedGroupId) {
				formData.append('group_id', selectedGroupId);
			}

			const response = await apiFetch({
				path: '/fair-audience/v1/import/kit',
				method: 'POST',
				body: formData,
			});

			setResults(response);
			setFile(null);
			document.getElementById('kit-file-input').value = '';
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
		<Card>
			<CardBody>
				<h2>{__('Import from Kit.com', 'fair-audience')}</h2>
				<p>
					{__(
						'Upload a Kit.com CSV export file to import subscribers as participants.',
						'fair-audience'
					)}
				</p>

				<div style={{ marginTop: '20px' }}>
					<SelectControl
						label={__('Group (Optional)', 'fair-audience')}
						value={selectedGroupId}
						onChange={setSelectedGroupId}
						disabled={isLoadingGroups || isUploading}
						help={__(
							'Select a group to add imported participants to it.',
							'fair-audience'
						)}
					>
						<option value="">
							{__('No group', 'fair-audience')}
						</option>
						{groups.map((group) => (
							<option key={group.id} value={group.id}>
								{group.name}
							</option>
						))}
					</SelectControl>
				</div>

				<div style={{ marginTop: '20px' }}>
					<SelectControl
						label={__('Mailing', 'fair-audience')}
						value={emailProfile}
						onChange={setEmailProfile}
						disabled={isUploading}
						options={[
							{
								label: __('Minimal', 'fair-audience'),
								value: 'minimal',
							},
							{
								label: __('Marketing', 'fair-audience'),
								value: 'marketing',
							},
						]}
					/>
				</div>

				<div style={{ marginTop: '20px' }}>
					<input
						id="kit-file-input"
						type="file"
						accept=".csv"
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
								{results.added_to_group > 0 && (
									<li>
										{__('Added to group:', 'fair-audience')}{' '}
										{results.added_to_group}
									</li>
								)}
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
	);
}
