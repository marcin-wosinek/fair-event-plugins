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
	TabPanel,
} from '@wordpress/components';

export default function Import() {
	const [file, setFile] = useState(null);
	const [isUploading, setIsUploading] = useState(false);
	const [results, setResults] = useState(null);
	const [error, setError] = useState(null);
	const [duplicateResolutions, setDuplicateResolutions] = useState({});
	const [isResolvingDuplicates, setIsResolvingDuplicates] = useState(false);
	const [importFilename, setImportFilename] = useState('');
	const [events, setEvents] = useState([]);
	const [selectedEventId, setSelectedEventId] = useState('');
	const [isLoadingEvents, setIsLoadingEvents] = useState(true);

	useEffect(() => {
		apiFetch({ path: '/fair-audience/v1/events' })
			.then((data) => {
				setEvents(data);
				setIsLoadingEvents(false);
			})
			.catch(() => {
				setIsLoadingEvents(false);
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
		setDuplicateResolutions({});

		try {
			const formData = new FormData();
			formData.append('file', file);
			if (selectedEventId) {
				formData.append('event_id', selectedEventId);
			}

			const response = await apiFetch({
				path: '/fair-audience/v1/import/entradium',
				method: 'POST',
				body: formData,
			});

			setResults(response);
			setImportFilename(file.name);
			setFile(null);
			// Reset file input
			document.getElementById('file-input').value = '';

			// Initialize duplicate resolutions with default values
			if (response.duplicates && response.duplicates.length > 0) {
				const initialResolutions = {};
				response.duplicates.forEach((dup) => {
					dup.rows.forEach((row) => {
						initialResolutions[`${dup.email}-${row.row}`] = {
							email: '',
							action: 'edit', // 'edit', 'skip', or 'alias'
							originalEmail: dup.email,
							row: row.row,
							name: row.name,
							surname: row.surname,
						};
					});
				});
				setDuplicateResolutions(initialResolutions);
			}
		} catch (err) {
			setError(
				err.message ||
					__('Import failed. Please try again.', 'fair-audience')
			);
		} finally {
			setIsUploading(false);
		}
	};

	const handleResolutionChange = (key, field, value) => {
		setDuplicateResolutions((prev) => ({
			...prev,
			[key]: {
				...prev[key],
				[field]: value,
			},
		}));
	};

	const handleUseGmailAlias = (key) => {
		const resolution = duplicateResolutions[key];
		const baseEmail = resolution.originalEmail.replace('@gmail.com', '');
		const firstName = resolution.name.toLowerCase().replace(/\s+/g, '');
		const aliasEmail = `${baseEmail}+${firstName}@gmail.com`;

		handleResolutionChange(key, 'email', aliasEmail);
		handleResolutionChange(key, 'action', 'alias');
	};

	const handleUseOriginalEmail = (key) => {
		const resolution = duplicateResolutions[key];
		handleResolutionChange(key, 'email', resolution.originalEmail);
		handleResolutionChange(key, 'action', 'edit');
	};

	const handleResolveDuplicates = async () => {
		setIsResolvingDuplicates(true);
		setError(null);

		try {
			const participantsToCreate = Object.values(duplicateResolutions)
				.filter((res) => res.action !== 'skip' && res.email)
				.map((res) => ({
					name: res.name,
					surname: res.surname,
					email: res.email,
					original_email: res.originalEmail,
					row_number: res.row,
					resolution_action: res.action,
				}));

			if (participantsToCreate.length === 0) {
				setError(
					__(
						'No participants to create. Please provide email addresses or select skip.',
						'fair-audience'
					)
				);
				setIsResolvingDuplicates(false);
				return;
			}

			const requestData = {
				participants: participantsToCreate,
				filename: importFilename || 'unknown',
			};
			if (selectedEventId) {
				requestData.event_id = parseInt(selectedEventId);
			}

			const response = await apiFetch({
				path: '/fair-audience/v1/import/resolve-duplicates',
				method: 'POST',
				data: requestData,
			});

			// Update results to show the resolution
			setResults((prev) => ({
				...prev,
				imported: prev.imported + response.imported,
				existing_linked:
					(prev.existing_linked || 0) +
					(response.existing_linked || 0),
				duplicates: [],
			}));
			setDuplicateResolutions({});
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to resolve duplicates. Please try again.',
						'fair-audience'
					)
			);
		} finally {
			setIsResolvingDuplicates(false);
		}
	};

	return (
		<div className="wrap">
			<h1>{__('Import Participants', 'fair-audience')}</h1>

			<TabPanel
				className="fair-audience-import-tabs"
				activeClass="is-active"
				tabs={[
					{
						name: 'entradium',
						title: __('Entradium', 'fair-audience'),
					},
				]}
			>
				{(tab) => (
					<>
						{tab.name === 'entradium' && (
							<Card>
								<CardBody>
									<h2>
										{__(
											'Import from Entradium',
											'fair-audience'
										)}
									</h2>
									<p>
										{__(
											'Upload an Entradium Excel file (.xlsx) to import participants. The file must contain columns: Nombre, Apellidos, and Email.',
											'fair-audience'
										)}
									</p>

									<div style={{ marginTop: '20px' }}>
										<SelectControl
											label={__(
												'Related Event (Optional)',
												'fair-audience'
											)}
											value={selectedEventId}
											onChange={setSelectedEventId}
											disabled={
												isLoadingEvents || isUploading
											}
											help={__(
												'Select an event to associate imported participants with it. Leave empty to import without event association.',
												'fair-audience'
											)}
										>
											<option value="">
												{__(
													'No event association',
													'fair-audience'
												)}
											</option>
											{events.map((event) => (
												<option
													key={event.event_id}
													value={event.event_id}
												>
													{event.title}
												</option>
											))}
										</SelectControl>
									</div>

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
													{__(
														'Selected file:',
														'fair-audience'
													)}
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
												? __(
														'Importing...',
														'fair-audience'
													)
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
											<Notice
												status="error"
												isDismissible={false}
											>
												{error}
											</Notice>
										</div>
									)}

									{results && (
										<div style={{ marginTop: '20px' }}>
											<Notice
												status={
													results.duplicates &&
													results.duplicates.length >
														0
														? 'warning'
														: 'success'
												}
												isDismissible={false}
											>
												<p>
													<strong>
														{results.duplicates &&
														results.duplicates
															.length > 0
															? __(
																	'Import Partially Complete',
																	'fair-audience'
																)
															: __(
																	'Import Complete',
																	'fair-audience'
																)}
													</strong>
												</p>
												<ul>
													<li>
														{__(
															'Imported:',
															'fair-audience'
														)}{' '}
														{results.imported}
													</li>
													{results.existing_linked >
														0 && (
														<li>
															{__(
																'Existing linked to event:',
																'fair-audience'
															)}{' '}
															{
																results.existing_linked
															}
														</li>
													)}
													{results.auto_resolved >
														0 && (
														<li>
															{__(
																'Auto-resolved from previous imports:',
																'fair-audience'
															)}{' '}
															{
																results.auto_resolved
															}
														</li>
													)}
													<li>
														{__(
															'Skipped (already exists):',
															'fair-audience'
														)}{' '}
														{results.skipped}
													</li>
													{results.duplicates &&
														results.duplicates
															.length > 0 && (
															<li>
																{__(
																	'Duplicates requiring resolution:',
																	'fair-audience'
																)}{' '}
																{results.duplicates.reduce(
																	(
																		sum,
																		dup
																	) =>
																		sum +
																		dup.count,
																	0
																)}
															</li>
														)}
												</ul>
											</Notice>

											{results.duplicates &&
												results.duplicates.length >
													0 && (
													<div
														style={{
															marginTop: '20px',
														}}
													>
														<h3>
															{__(
																'Resolve Duplicate Emails',
																'fair-audience'
															)}
														</h3>
														<p>
															{__(
																'The following people have duplicate email addresses. Please provide a unique email for each person or skip them.',
																'fair-audience'
															)}
														</p>

														{results.duplicates.map(
															(dup, dupIndex) => (
																<div
																	key={
																		dupIndex
																	}
																	style={{
																		marginTop:
																			'20px',
																		padding:
																			'15px',
																		backgroundColor:
																			'#fff3cd',
																		border: '1px solid #ffc107',
																		borderRadius:
																			'4px',
																	}}
																>
																	<p>
																		<strong>
																			{__(
																				'Original Email:',
																				'fair-audience'
																			)}
																		</strong>{' '}
																		{
																			dup.email
																		}
																	</p>

																	{dup.rows.map(
																		(
																			row,
																			rowIndex
																		) => {
																			const key = `${dup.email}-${row.row}`;
																			const resolution =
																				duplicateResolutions[
																					key
																				];

																			return (
																				<div
																					key={
																						rowIndex
																					}
																					style={{
																						marginTop:
																							'15px',
																						padding:
																							'10px',
																						backgroundColor:
																							'#fff',
																						border: '1px solid #ddd',
																						borderRadius:
																							'4px',
																					}}
																				>
																					<p>
																						<strong>
																							{
																								row.name
																							}{' '}
																							{
																								row.surname
																							}
																						</strong>{' '}
																						(Row{' '}
																						{
																							row.row
																						}

																						)
																					</p>

																					<div
																						style={{
																							marginTop:
																								'10px',
																							display:
																								'flex',
																							gap: '10px',
																							alignItems:
																								'center',
																							flexWrap:
																								'wrap',
																						}}
																					>
																						<label>
																							{__(
																								'New Email:',
																								'fair-audience'
																							)}
																							<input
																								type="email"
																								value={
																									resolution?.email ||
																									''
																								}
																								onChange={(
																									e
																								) =>
																									handleResolutionChange(
																										key,
																										'email',
																										e
																											.target
																											.value
																									)
																								}
																								style={{
																									marginLeft:
																										'10px',
																									padding:
																										'5px',
																									width: '250px',
																								}}
																								placeholder={__(
																									'Enter new email',
																									'fair-audience'
																								)}
																							/>
																						</label>

																						{dup.email.includes(
																							'@gmail.com'
																						) && (
																							<Button
																								isSecondary
																								isSmall
																								onClick={() =>
																									handleUseGmailAlias(
																										key
																									)
																								}
																							>
																								{__(
																									'Use Gmail Alias',
																									'fair-audience'
																								)}
																							</Button>
																						)}

																						<Button
																							isSecondary
																							isSmall
																							onClick={() =>
																								handleUseOriginalEmail(
																									key
																								)
																							}
																						>
																							{__(
																								'Use Original Email',
																								'fair-audience'
																							)}
																						</Button>

																						<label
																							style={{
																								marginLeft:
																									'10px',
																							}}
																						>
																							<input
																								type="checkbox"
																								checked={
																									resolution?.action ===
																									'skip'
																								}
																								onChange={(
																									e
																								) =>
																									handleResolutionChange(
																										key,
																										'action',
																										e
																											.target
																											.checked
																											? 'skip'
																											: 'edit'
																									)
																								}
																								style={{
																									marginRight:
																										'5px',
																								}}
																							/>
																							{__(
																								'Skip this person',
																								'fair-audience'
																							)}
																						</label>
																					</div>
																				</div>
																			);
																		}
																	)}
																</div>
															)
														)}

														<div
															style={{
																marginTop:
																	'20px',
															}}
														>
															<Button
																isPrimary
																onClick={
																	handleResolveDuplicates
																}
																disabled={
																	isResolvingDuplicates
																}
															>
																{isResolvingDuplicates
																	? __(
																			'Resolving...',
																			'fair-audience'
																		)
																	: __(
																			'Create Participants',
																			'fair-audience'
																		)}
															</Button>
														</div>
													</div>
												)}

											{results.errors &&
												results.errors.length > 0 && (
													<Notice
														status="warning"
														isDismissible={false}
														style={{
															marginTop: '10px',
														}}
													>
														<p>
															<strong>
																{__(
																	'Errors:',
																	'fair-audience'
																)}
															</strong>
														</p>
														<ul>
															{results.errors.map(
																(
																	err,
																	index
																) => (
																	<li
																		key={
																			index
																		}
																	>
																		{err}
																	</li>
																)
															)}
														</ul>
													</Notice>
												)}
										</div>
									)}
								</CardBody>
							</Card>
						)}
					</>
				)}
			</TabPanel>
		</div>
	);
}
