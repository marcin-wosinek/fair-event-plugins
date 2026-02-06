/**
 * Image Exports Component
 *
 * Generates cropped versions of the theme image for different platforms.
 *
 * @package FairEvents
 */

import { useState } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const FORMATS = [
	{ key: 'entradium', label: 'Entradium', width: 660, height: 930 },
	{ key: 'meetup', label: 'Meetup', width: 1080, height: 608 },
	{ key: 'homepage', label: 'Homepage', width: 1206, height: 322 },
	{ key: 'facebook', label: 'Facebook', width: 1920, height: 1080 },
];

export default function ImageExports({
	eventDateId,
	themeImageId,
	initialExports,
}) {
	const [exports, setExports] = useState(initialExports || []);
	const [generating, setGenerating] = useState({});
	const [deleting, setDeleting] = useState({});
	const [generatingAll, setGeneratingAll] = useState(false);
	const [error, setError] = useState(null);

	if (!themeImageId) {
		return null;
	}

	const getExportForFormat = (formatKey) => {
		return exports.find((exp) => exp.format === formatKey);
	};

	const handleGenerate = async (formatKey) => {
		setGenerating((prev) => ({ ...prev, [formatKey]: true }));
		setError(null);

		try {
			const result = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/image-exports`,
				method: 'POST',
				data: { format: formatKey },
			});
			setExports(result);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to generate image export.', 'fair-events')
			);
		} finally {
			setGenerating((prev) => ({ ...prev, [formatKey]: false }));
		}
	};

	const handleDelete = async (formatKey) => {
		setDeleting((prev) => ({ ...prev, [formatKey]: true }));
		setError(null);

		try {
			const result = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/image-exports/${formatKey}`,
				method: 'DELETE',
			});
			setExports(result);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to delete image export.', 'fair-events')
			);
		} finally {
			setDeleting((prev) => ({ ...prev, [formatKey]: false }));
		}
	};

	const handleGenerateAll = async () => {
		setGeneratingAll(true);
		setError(null);

		for (const format of FORMATS) {
			setGenerating((prev) => ({ ...prev, [format.key]: true }));
			try {
				const result = await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/image-exports`,
					method: 'POST',
					data: { format: format.key },
				});
				setExports(result);
			} catch (err) {
				setError(
					err.message ||
						__('Failed to generate image export.', 'fair-events')
				);
				setGenerating((prev) => ({ ...prev, [format.key]: false }));
				break;
			}
			setGenerating((prev) => ({ ...prev, [format.key]: false }));
		}

		setGeneratingAll(false);
	};

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<HStack alignment="center" justify="space-between">
					<h2>{__('Image Exports', 'fair-events')}</h2>
					<Button
						variant="primary"
						onClick={handleGenerateAll}
						isBusy={generatingAll}
						disabled={generatingAll}
						size="compact"
					>
						{__('Generate All', 'fair-events')}
					</Button>
				</HStack>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					{error && (
						<Notice
							status="error"
							isDismissible
							onRemove={() => setError(null)}
						>
							{error}
						</Notice>
					)}

					{FORMATS.map((format) => {
						const existing = getExportForFormat(format.key);
						const isGenerating = generating[format.key];
						const isDeleting = deleting[format.key];

						return (
							<div
								key={format.key}
								style={{
									border: '1px solid #ddd',
									padding: '12px',
									borderRadius: '4px',
								}}
							>
								<HStack
									alignment="top"
									spacing={4}
									wrap
									justify="space-between"
								>
									<VStack spacing={2}>
										<strong>
											{format.label} ({format.width}
											&times;
											{format.height})
										</strong>
										{existing && existing.thumbnail_url && (
											<img
												src={existing.thumbnail_url}
												alt={format.label}
												style={{
													maxWidth: '200px',
													maxHeight: '120px',
													objectFit: 'contain',
													border: '1px solid #eee',
												}}
											/>
										)}
									</VStack>
									<HStack spacing={2}>
										{isGenerating ? (
											<Spinner />
										) : (
											<Button
												variant="secondary"
												onClick={() =>
													handleGenerate(format.key)
												}
												disabled={
													generatingAll || isDeleting
												}
												size="compact"
											>
												{existing
													? __(
															'Regenerate',
															'fair-events'
													  )
													: __(
															'Generate',
															'fair-events'
													  )}
											</Button>
										)}
										{existing && (
											<>
												<Button
													variant="link"
													href={existing.url}
													target="_blank"
													size="compact"
												>
													{__(
														'Download',
														'fair-events'
													)}
												</Button>
												{isDeleting ? (
													<Spinner />
												) : (
													<Button
														variant="tertiary"
														isDestructive
														onClick={() =>
															handleDelete(
																format.key
															)
														}
														disabled={
															generatingAll ||
															isGenerating
														}
														size="compact"
													>
														{__(
															'Delete',
															'fair-events'
														)}
													</Button>
												)}
											</>
										)}
									</HStack>
								</HStack>
							</div>
						);
					})}
				</VStack>
			</CardBody>
		</Card>
	);
}
