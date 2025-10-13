/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';

/**
 * Auto-detect field mapping based on column name
 *
 * @param {string} columnName CSV column name
 * @return {string} WordPress user field or empty string
 */
function autoDetectField(columnName) {
	const normalized = columnName.toLowerCase().trim();

	// Username mappings
	if (
		normalized === 'username' ||
		normalized === 'user_login' ||
		normalized === 'login'
	) {
		return 'user_login';
	}

	// Email mappings
	if (
		normalized === 'email' ||
		normalized === 'user_email' ||
		normalized === 'e-mail'
	) {
		return 'user_email';
	}

	// Display name mappings
	if (
		normalized === 'display name' ||
		normalized === 'display_name' ||
		normalized === 'displayname' ||
		normalized === 'name'
	) {
		return 'display_name';
	}

	// First name mappings
	if (
		normalized === 'first name' ||
		normalized === 'first_name' ||
		normalized === 'firstname'
	) {
		return 'first_name';
	}

	// Last name mappings
	if (
		normalized === 'last name' ||
		normalized === 'last_name' ||
		normalized === 'lastname'
	) {
		return 'last_name';
	}

	// URL mappings
	if (
		normalized === 'url' ||
		normalized === 'user_url' ||
		normalized === 'website'
	) {
		return 'user_url';
	}

	// Description/Bio mappings
	if (
		normalized === 'description' ||
		normalized === 'bio' ||
		normalized === 'biography'
	) {
		return 'description';
	}

	return '';
}

/**
 * Mapping Step Component - Map CSV columns to WordPress user fields
 *
 * @param {Object} props Component props
 * @param {Array} props.csvData Parsed CSV data
 * @param {Object} props.initialMapping Initial field mapping
 * @param {Function} props.onComplete Callback when mapping is complete
 * @param {Function} props.onBack Callback to go back
 * @return {JSX.Element} The Mapping Step component
 */
export default function MappingStep({
	csvData,
	initialMapping,
	onComplete,
	onBack,
}) {
	const [mapping, setMapping] = useState(initialMapping || {});
	const [errors, setErrors] = useState([]);

	// Available WordPress user fields
	const userFields = [
		{ value: '', label: __('— Skip this column —', 'fair-membership') },
		{
			value: 'user_login',
			label: __('Username (required)', 'fair-membership'),
		},
		{
			value: 'user_email',
			label: __('Email (required)', 'fair-membership'),
		},
		{ value: 'display_name', label: __('Display Name', 'fair-membership') },
		{ value: 'first_name', label: __('First Name', 'fair-membership') },
		{ value: 'last_name', label: __('Last Name', 'fair-membership') },
		{ value: 'user_url', label: __('Website URL', 'fair-membership') },
		{ value: 'description', label: __('Biography', 'fair-membership') },
	];

	// Get CSV columns from first row
	const columns = csvData.length > 0 ? Object.keys(csvData[0]) : [];

	// Auto-detect mapping on mount if no initial mapping
	useEffect(() => {
		if (!initialMapping || Object.keys(initialMapping).length === 0) {
			const autoMapping = {};
			columns.forEach((col) => {
				const detected = autoDetectField(col);
				if (detected) {
					autoMapping[col] = detected;
				}
			});
			setMapping(autoMapping);
		}
	}, []);

	const handleMappingChange = (column, field) => {
		setMapping((prev) => ({
			...prev,
			[column]: field,
		}));
	};

	const validateMapping = () => {
		const validationErrors = [];

		// Check if user_login is mapped
		const hasUsername = Object.values(mapping).includes('user_login');
		if (!hasUsername) {
			validationErrors.push(
				__(
					'Username field is required. Please map a column to Username.',
					'fair-membership'
				)
			);
		}

		// Check if user_email is mapped
		const hasEmail = Object.values(mapping).includes('user_email');
		if (!hasEmail) {
			validationErrors.push(
				__(
					'Email field is required. Please map a column to Email.',
					'fair-membership'
				)
			);
		}

		// Check for duplicate mappings (excluding empty values)
		const mappedFields = Object.values(mapping).filter(
			(field) => field !== ''
		);
		const uniqueFields = new Set(mappedFields);
		if (mappedFields.length !== uniqueFields.size) {
			validationErrors.push(
				__(
					'Each field can only be mapped once. Please check for duplicate mappings.',
					'fair-membership'
				)
			);
		}

		return validationErrors;
	};

	const handleContinue = () => {
		const validationErrors = validateMapping();

		if (validationErrors.length > 0) {
			setErrors(validationErrors);
			return;
		}

		setErrors([]);
		onComplete(mapping);
	};

	// Get sample data for preview (first row)
	const sampleRow = csvData[0] || {};

	return (
		<div className="fair-membership-mapping-step">
			<p>
				{__(
					'Map CSV columns to WordPress user fields. Required fields are Username and Email.',
					'fair-membership'
				)}
			</p>

			{errors.length > 0 && (
				<div className="notice notice-error">
					<ul>
						{errors.map((error, idx) => (
							<li key={idx}>{error}</li>
						))}
					</ul>
				</div>
			)}

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th style={{ width: '30%' }}>
							{__('CSV Column', 'fair-membership')}
						</th>
						<th style={{ width: '30%' }}>
							{__('Sample Data', 'fair-membership')}
						</th>
						<th style={{ width: '40%' }}>
							{__('Maps to WordPress Field', 'fair-membership')}
						</th>
					</tr>
				</thead>
				<tbody>
					{columns.map((column) => (
						<tr key={column}>
							<td>
								<strong>{column}</strong>
							</td>
							<td>
								<code>{sampleRow[column] || '—'}</code>
							</td>
							<td>
								<select
									value={mapping[column] || ''}
									onChange={(e) =>
										handleMappingChange(
											column,
											e.target.value
										)
									}
									className="regular-text"
								>
									{userFields.map((field) => (
										<option
											key={field.value}
											value={field.value}
										>
											{field.label}
										</option>
									))}
								</select>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="fair-membership-mapping-summary">
				<h3>{__('Mapping Summary', 'fair-membership')}</h3>
				<ul>
					<li>
						<strong>
							{__('Total columns:', 'fair-membership')}
						</strong>{' '}
						{columns.length}
					</li>
					<li>
						<strong>{__('Mapped:', 'fair-membership')}</strong>{' '}
						{
							Object.values(mapping).filter(
								(field) => field !== ''
							).length
						}
					</li>
					<li>
						<strong>{__('Skipped:', 'fair-membership')}</strong>{' '}
						{
							columns.filter(
								(col) => !mapping[col] || mapping[col] === ''
							).length
						}
					</li>
				</ul>
			</div>

			<div className="fair-membership-mapping-actions">
				<button
					type="button"
					className="button"
					onClick={onBack}
					style={{ marginRight: '10px' }}
				>
					{__('← Back', 'fair-membership')}
				</button>
				<button
					type="button"
					className="button button-primary"
					onClick={handleContinue}
				>
					{__('Continue to Preview', 'fair-membership')}
				</button>
			</div>

			<style>{`
				.fair-membership-mapping-step {
					margin-top: 20px;
				}
				.fair-membership-mapping-summary {
					margin: 20px 0;
					padding: 15px;
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
				}
				.fair-membership-mapping-summary h3 {
					margin-top: 0;
				}
				.fair-membership-mapping-summary ul {
					margin: 0;
				}
				.fair-membership-mapping-actions {
					margin-top: 20px;
				}
			`}</style>
		</div>
	);
}
