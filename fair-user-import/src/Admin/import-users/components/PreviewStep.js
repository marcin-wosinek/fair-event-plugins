/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Preview Step Component - Preview and edit imported users
 *
 * @param {Object} props Component props
 * @param {Array} props.csvData Parsed CSV data
 * @param {Object} props.fieldMapping Field mapping
 * @param {Object} props.initialUserData Initial user data
 * @param {Object} props.initialActions Initial user actions
 * @param {Function} props.onComplete Callback when preview is complete
 * @param {Function} props.onBack Callback to go back
 * @return {JSX.Element} The Preview Step component
 */
export default function PreviewStep({
	csvData,
	fieldMapping,
	initialUserData,
	initialActions,
	onComplete,
	onBack,
}) {
	const [userData, setUserData] = useState(initialUserData || []);
	const [userActions, setUserActions] = useState(initialActions || {});
	const [validationErrors, setValidationErrors] = useState({});
	const [isValidating, setIsValidating] = useState(false);
	const [filterErrors, setFilterErrors] = useState(false);
	const [editingCell, setEditingCell] = useState(null);

	// Transform CSV data to user data based on mapping
	useEffect(() => {
		if (!initialUserData || initialUserData.length === 0) {
			const transformedData = csvData.map((row, index) => {
				const user = { _rowIndex: index };

				Object.entries(fieldMapping).forEach(([csvCol, wpField]) => {
					if (wpField && wpField !== '') {
						user[wpField] = row[csvCol] || '';
					}
				});

				return user;
			});

			setUserData(transformedData);
		}
	}, [csvData, fieldMapping, initialUserData]);

	// Validate users on mount or when userData changes
	useEffect(() => {
		if (userData.length > 0 && Object.keys(validationErrors).length === 0) {
			validateUsers();
		}
	}, [userData]);

	const validateUsers = async () => {
		setIsValidating(true);

		try {
			const response = await apiFetch({
				path: '/fair-user-import/v1/import-users/validate',
				method: 'POST',
				data: {
					users: userData,
				},
			});

			if (response.success) {
				setValidationErrors(response.data.validation || {});

				// Set initial actions based on existing users
				const actions = {};
				userData.forEach((user, index) => {
					if (response.data.existing_users[index]) {
						// User exists - default to skip, let user decide
						actions[index] = 'skip';
					} else {
						// New user - default to create
						actions[index] = 'create';
					}
				});
				setUserActions(actions);
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('Validation failed:', err);
		} finally {
			setIsValidating(false);
		}
	};

	const handleFieldEdit = (rowIndex, field, value) => {
		setUserData((prev) =>
			prev.map((user, idx) => {
				if (idx === rowIndex) {
					return { ...user, [field]: value };
				}
				return user;
			})
		);

		// Clear validation errors for this row
		if (validationErrors[rowIndex]) {
			setValidationErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[rowIndex];
				return newErrors;
			});
		}
	};

	const handleActionChange = (rowIndex, action) => {
		setUserActions((prev) => ({
			...prev,
			[rowIndex]: action,
		}));
	};

	const handleContinue = () => {
		// Filter out skipped users
		const activeUsers = userData.filter(
			(user, idx) => userActions[idx] !== 'skip'
		);

		if (activeUsers.length === 0) {
			alert(
				__(
					'Please select at least one user to import.',
					'fair-user-import'
				)
			);
			return;
		}

		onComplete(userData, userActions);
	};

	const displayedUsers = filterErrors
		? userData.filter((user, idx) => validationErrors[idx])
		: userData;

	// Get displayed fields (only mapped fields)
	const displayFields = Object.values(fieldMapping).filter(
		(field) => field !== ''
	);

	const getFieldLabel = (field) => {
		const labels = {
			user_login: __('Username', 'fair-user-import'),
			user_email: __('Email', 'fair-user-import'),
			display_name: __('Display Name', 'fair-user-import'),
			first_name: __('First Name', 'fair-user-import'),
			last_name: __('Last Name', 'fair-user-import'),
			user_url: __('Website', 'fair-user-import'),
			description: __('Bio', 'fair-user-import'),
		};
		return labels[field] || field;
	};

	const getActionOptions = (rowIndex) => {
		const hasErrors = validationErrors[rowIndex];

		return [
			{
				value: 'create',
				label: __('Create', 'fair-user-import'),
				disabled: hasErrors,
			},
			{
				value: 'update',
				label: __('Update', 'fair-user-import'),
				disabled: hasErrors,
			},
			{ value: 'skip', label: __('Skip', 'fair-user-import') },
		];
	};

	return (
		<div className="fair-membership-preview-step">
			<p>
				{__(
					'Review and edit user data. Choose an action for each user: Create (new user), Update (existing user), or Skip.',
					'fair-user-import'
				)}
			</p>

			{isValidating && (
				<div className="notice notice-info">
					<p>{__('Validating users...', 'fair-user-import')}</p>
				</div>
			)}

			<div className="fair-membership-preview-controls">
				<label>
					<input
						type="checkbox"
						checked={filterErrors}
						onChange={(e) => setFilterErrors(e.target.checked)}
					/>
					{__('Show only rows with errors', 'fair-user-import')}
				</label>
				<span style={{ marginLeft: '20px' }}>
					<strong>{__('Showing:', 'fair-user-import')}</strong>{' '}
					{displayedUsers.length} / {userData.length}{' '}
					{__('users', 'fair-user-import')}
				</span>
			</div>

			<div className="fair-membership-preview-table-wrapper">
				<table className="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th style={{ width: '50px' }}>
								{__('#', 'fair-user-import')}
							</th>
							{displayFields.map((field) => (
								<th key={field}>{getFieldLabel(field)}</th>
							))}
							<th style={{ width: '120px' }}>
								{__('Action', 'fair-user-import')}
							</th>
						</tr>
					</thead>
					<tbody>
						{displayedUsers.map((user) => {
							const rowIndex = user._rowIndex;
							const hasError = validationErrors[rowIndex];

							return (
								<tr
									key={rowIndex}
									className={hasError ? 'error-row' : ''}
								>
									<td>{rowIndex + 1}</td>
									{displayFields.map((field) => (
										<td
											key={field}
											onDoubleClick={() =>
												setEditingCell(
													`${rowIndex}-${field}`
												)
											}
										>
											{editingCell ===
											`${rowIndex}-${field}` ? (
												<input
													type="text"
													value={user[field] || ''}
													onChange={(e) =>
														handleFieldEdit(
															rowIndex,
															field,
															e.target.value
														)
													}
													onBlur={() =>
														setEditingCell(null)
													}
													onKeyDown={(e) => {
														if (
															e.key === 'Enter' ||
															e.key === 'Escape'
														) {
															setEditingCell(
																null
															);
														}
													}}
													autoFocus
													style={{ width: '100%' }}
												/>
											) : (
												<span
													style={{
														cursor: 'pointer',
													}}
													title={__(
														'Double-click to edit',
														'fair-user-import'
													)}
												>
													{user[field] || '—'}
												</span>
											)}
										</td>
									))}
									<td>
										<select
											value={
												userActions[rowIndex] ||
												'create'
											}
											onChange={(e) =>
												handleActionChange(
													rowIndex,
													e.target.value
												)
											}
											className="small-text"
										>
											{getActionOptions(rowIndex).map(
												(option) => (
													<option
														key={option.value}
														value={option.value}
														disabled={
															option.disabled
														}
													>
														{option.label}
													</option>
												)
											)}
										</select>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{Object.keys(validationErrors).length > 0 && (
				<div className="notice notice-warning">
					<p>
						<strong>
							{__('Validation Issues:', 'fair-user-import')}
						</strong>
					</p>
					<ul>
						{Object.entries(validationErrors).map(
							([rowIndex, errors]) => (
								<li key={rowIndex}>
									{__('Row', 'fair-user-import')}{' '}
									{Number(rowIndex) + 1}:{' '}
									{Array.isArray(errors)
										? errors.join(', ')
										: errors}
								</li>
							)
						)}
					</ul>
				</div>
			)}

			<div className="fair-membership-preview-summary">
				<h3>{__('Import Summary', 'fair-user-import')}</h3>
				<ul>
					<li>
						<strong>{__('To Create:', 'fair-user-import')}</strong>{' '}
						{
							Object.values(userActions).filter(
								(action) => action === 'create'
							).length
						}
					</li>
					<li>
						<strong>{__('To Update:', 'fair-user-import')}</strong>{' '}
						{
							Object.values(userActions).filter(
								(action) => action === 'update'
							).length
						}
					</li>
					<li>
						<strong>{__('To Skip:', 'fair-user-import')}</strong>{' '}
						{
							Object.values(userActions).filter(
								(action) => action === 'skip'
							).length
						}
					</li>
				</ul>
			</div>

			<div className="fair-membership-preview-actions">
				<button
					type="button"
					className="button"
					onClick={onBack}
					style={{ marginRight: '10px' }}
				>
					{__('← Back to Mapping', 'fair-user-import')}
				</button>
				<button
					type="button"
					className="button button-primary"
					onClick={handleContinue}
					disabled={isValidating}
				>
					{__('Continue to Groups', 'fair-user-import')}
				</button>
			</div>

			<style>{`
				.fair-membership-preview-step {
					margin-top: 20px;
				}
				.fair-membership-preview-controls {
					margin: 20px 0;
					padding: 10px;
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
				}
				.fair-membership-preview-table-wrapper {
					overflow-x: auto;
					margin: 20px 0;
				}
				.fair-membership-preview-table-wrapper table {
					min-width: 800px;
				}
				.error-row {
					background-color: #fcf0f1 !important;
				}
				.fair-membership-preview-summary {
					margin: 20px 0;
					padding: 15px;
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
				}
				.fair-membership-preview-summary h3 {
					margin-top: 0;
				}
				.fair-membership-preview-summary ul {
					margin: 0;
				}
				.fair-membership-preview-actions {
					margin-top: 20px;
				}
			`}</style>
		</div>
	);
}
