/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	TextControl,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadTemplates,
	registerTemplate,
	deleteTemplate,
	renderTemplate,
} from './image-templates-api.js';
import { svgToPng, downloadBlob } from './svg-to-png.js';

/**
 * Open the WordPress media picker and call onSelect with the chosen attachment.
 *
 * @param {Object}   options          Media picker options
 * @param {string}   options.title    Dialog title
 * @param {string}   options.button   Button label
 * @param {string}   options.type     MIME type filter
 * @param {Function} options.onSelect Callback receiving the selected attachment
 */
function openMediaPicker({ title, button, type, onSelect }) {
	const frame = wp.media({
		title,
		button: { text: button },
		library: { type },
		multiple: false,
	});
	frame.on('select', () => {
		const attachment = frame.state().get('selection').first().toJSON();
		onSelect(attachment);
	});
	frame.open();
}

/**
 * Image Templates page component
 *
 * @return {JSX.Element} The image templates page
 */
export default function ImageTemplates() {
	const [templates, setTemplates] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [notice, setNotice] = useState(null);

	// Render view state.
	const [activeTemplate, setActiveTemplate] = useState(null);
	const [variables, setVariables] = useState({});
	const [images, setImages] = useState({});
	const [imageNames, setImageNames] = useState({});
	const [renderedSvg, setRenderedSvg] = useState(null);
	const [isRendering, setIsRendering] = useState(false);

	const fetchTemplates = () => {
		setIsLoading(true);
		loadTemplates()
			.then((data) => {
				setTemplates(data);
				setIsLoading(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to load templates.', 'fair-audience'),
				});
				setIsLoading(false);
			});
	};

	useEffect(() => {
		fetchTemplates();
	}, []);

	const handleAddTemplate = () => {
		openMediaPicker({
			title: __('Select SVG Template', 'fair-audience'),
			button: __('Use as Template', 'fair-audience'),
			type: 'image/svg+xml',
			onSelect(attachment) {
				if (attachment.mime !== 'image/svg+xml') {
					setNotice({
						status: 'error',
						message: __(
							'Please select an SVG file.',
							'fair-audience'
						),
					});
					return;
				}

				registerTemplate(attachment.id)
					.then(() => {
						setNotice({
							status: 'success',
							message: __(
								'Template registered successfully.',
								'fair-audience'
							),
						});
						fetchTemplates();
					})
					.catch((error) => {
						setNotice({
							status: 'error',
							message:
								error.message ||
								__(
									'Failed to register template.',
									'fair-audience'
								),
						});
					});
			},
		});
	};

	const handleDelete = (id) => {
		if (
			!confirm(
				__(
					'Are you sure you want to remove this template?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		deleteTemplate(id)
			.then(() => {
				setNotice({
					status: 'success',
					message: __('Template removed.', 'fair-audience'),
				});
				if (activeTemplate && activeTemplate.id === id) {
					setActiveTemplate(null);
					setRenderedSvg(null);
				}
				fetchTemplates();
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to remove template.', 'fair-audience'),
				});
			});
	};

	const handleUse = (template) => {
		setActiveTemplate(template);
		setRenderedSvg(null);

		// Initialize variables with empty strings.
		const vars = {};
		template.variables.forEach((name) => {
			vars[name] = '';
		});
		setVariables(vars);

		// Initialize images with empty values.
		const imgs = {};
		const names = {};
		template.images.forEach((name) => {
			imgs[name] = null;
			names[name] = '';
		});
		setImages(imgs);
		setImageNames(names);
	};

	const handlePickImage = (name) => {
		openMediaPicker({
			title: __('Select Image', 'fair-audience'),
			button: __('Use Image', 'fair-audience'),
			type: 'image',
			onSelect(attachment) {
				setImages((prev) => ({ ...prev, [name]: attachment.id }));
				setImageNames((prev) => ({
					...prev,
					[name]: attachment.filename,
				}));
			},
		});
	};

	const handlePreview = () => {
		setIsRendering(true);
		setRenderedSvg(null);

		// Build images object with only non-null values.
		const imageData = {};
		Object.entries(images).forEach(([name, id]) => {
			if (id) {
				imageData[name] = id;
			}
		});

		renderTemplate(activeTemplate.id, variables, imageData)
			.then((data) => {
				setRenderedSvg(data.svg);
				setIsRendering(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to render template.', 'fair-audience'),
				});
				setIsRendering(false);
			});
	};

	const handleDownloadSvg = () => {
		if (!renderedSvg) {
			return;
		}
		const blob = new Blob([renderedSvg], { type: 'image/svg+xml' });
		const filename = (activeTemplate.title || 'template') + '.svg';
		downloadBlob(blob, filename);
	};

	const handleDownloadPng = async () => {
		if (!renderedSvg) {
			return;
		}
		try {
			const blob = await svgToPng(renderedSvg);
			const filename = (activeTemplate.title || 'template') + '.png';
			downloadBlob(blob, filename);
		} catch (error) {
			setNotice({
				status: 'error',
				message:
					error.message ||
					__('Failed to convert to PNG.', 'fair-audience'),
			});
		}
	};

	const handleBack = () => {
		setActiveTemplate(null);
		setRenderedSvg(null);
	};

	// Render view - when a template is selected for use.
	if (activeTemplate) {
		return (
			<div className="wrap">
				<h1>
					<Button
						variant="link"
						onClick={handleBack}
						style={{ marginRight: '8px' }}
					>
						&larr; {__('Back', 'fair-audience')}
					</Button>
					{activeTemplate.title}
				</h1>

				{notice && (
					<Notice
						status={notice.status}
						isDismissible
						onDismiss={() => setNotice(null)}
						style={{ marginBottom: '1rem' }}
					>
						{notice.message}
					</Notice>
				)}

				<Card style={{ marginBottom: '2rem' }}>
					<CardHeader>
						<h2 style={{ margin: 0 }}>
							{__('Template Variables', 'fair-audience')}
						</h2>
					</CardHeader>
					<CardBody>
						{activeTemplate.variables.length === 0 &&
							activeTemplate.images.length === 0 && (
								<p style={{ color: '#666' }}>
									{__(
										'This template has no placeholders.',
										'fair-audience'
									)}
								</p>
							)}

						{activeTemplate.variables.map((name) => (
							<TextControl
								key={name}
								label={name}
								value={variables[name] || ''}
								onChange={(value) =>
									setVariables((prev) => ({
										...prev,
										[name]: value,
									}))
								}
							/>
						))}

						{activeTemplate.images.map((name) => (
							<div
								key={name}
								style={{
									marginBottom: '1rem',
									display: 'flex',
									alignItems: 'center',
									gap: '8px',
								}}
							>
								<span style={{ fontWeight: 500 }}>{name}:</span>
								<Button
									variant="secondary"
									isSmall
									onClick={() => handlePickImage(name)}
								>
									{imageNames[name]
										? imageNames[name]
										: __('Select Image', 'fair-audience')}
								</Button>
								{images[name] && (
									<Button
										isDestructive
										isSmall
										onClick={() => {
											setImages((prev) => ({
												...prev,
												[name]: null,
											}));
											setImageNames((prev) => ({
												...prev,
												[name]: '',
											}));
										}}
									>
										{__('Clear', 'fair-audience')}
									</Button>
								)}
							</div>
						))}

						<div
							style={{
								marginTop: '1rem',
								display: 'flex',
								gap: '8px',
							}}
						>
							<Button
								variant="primary"
								onClick={handlePreview}
								isBusy={isRendering}
								disabled={isRendering}
							>
								{isRendering
									? __('Rendering...', 'fair-audience')
									: __('Preview', 'fair-audience')}
							</Button>
						</div>
					</CardBody>
				</Card>

				{renderedSvg && (
					<Card>
						<CardHeader>
							<h2 style={{ margin: 0 }}>
								{__('Preview', 'fair-audience')}
							</h2>
						</CardHeader>
						<CardBody>
							<div
								style={{
									maxWidth: '100%',
									overflow: 'auto',
									marginBottom: '1rem',
								}}
								dangerouslySetInnerHTML={{
									__html: renderedSvg,
								}}
							/>
							<div
								style={{
									display: 'flex',
									gap: '8px',
								}}
							>
								<Button
									variant="secondary"
									onClick={handleDownloadSvg}
								>
									{__('Download SVG', 'fair-audience')}
								</Button>
								<Button
									variant="secondary"
									onClick={handleDownloadPng}
								>
									{__('Download PNG', 'fair-audience')}
								</Button>
							</div>
						</CardBody>
					</Card>
				)}
			</div>
		);
	}

	// List view.
	return (
		<div className="wrap">
			<h1>{__('Image Templates', 'fair-audience')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible
					onDismiss={() => setNotice(null)}
					style={{ marginBottom: '1rem' }}
				>
					{notice.message}
				</Notice>
			)}

			<Card>
				<CardHeader
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
					}}
				>
					<h2 style={{ margin: 0 }}>
						{__('Templates', 'fair-audience')}
					</h2>
					<Button variant="primary" onClick={handleAddTemplate}>
						{__('Add Template', 'fair-audience')}
					</Button>
				</CardHeader>
				<CardBody>
					{isLoading ? (
						<div
							style={{
								display: 'flex',
								justifyContent: 'center',
								padding: '2rem',
							}}
						>
							<Spinner />
						</div>
					) : templates.length === 0 ? (
						<p style={{ color: '#666' }}>
							{__(
								'No templates yet. Upload an SVG file with {{variable}} placeholders to get started.',
								'fair-audience'
							)}
						</p>
					) : (
						<table
							className="wp-list-table widefat fixed striped"
							style={{ marginTop: 0 }}
						>
							<thead>
								<tr>
									<th style={{ width: '30%' }}>
										{__('Name', 'fair-audience')}
									</th>
									<th style={{ width: '25%' }}>
										{__(
											'Text Placeholders',
											'fair-audience'
										)}
									</th>
									<th style={{ width: '25%' }}>
										{__(
											'Image Placeholders',
											'fair-audience'
										)}
									</th>
									<th style={{ width: '20%' }}>
										{__('Actions', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{templates.map((template) => (
									<tr key={template.id}>
										<td>{template.title}</td>
										<td>
											{template.variables.length > 0
												? template.variables.join(', ')
												: '-'}
										</td>
										<td>
											{template.images.length > 0
												? template.images.join(', ')
												: '-'}
										</td>
										<td>
											<div
												style={{
													display: 'flex',
													gap: '8px',
												}}
											>
												<Button
													variant="secondary"
													isSmall
													onClick={() =>
														handleUse(template)
													}
												>
													{__('Use', 'fair-audience')}
												</Button>
												<Button
													isDestructive
													isSmall
													onClick={() =>
														handleDelete(
															template.id
														)
													}
												>
													{__(
														'Delete',
														'fair-audience'
													)}
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
