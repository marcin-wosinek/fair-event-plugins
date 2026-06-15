/**
 * Merge Event Wizard
 *
 * Multi-step wizard for merging one event_date into another.
 *
 * @package FairEventsExperimental
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	TextControl,
	SelectControl,
	CheckboxControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const RELATIONSHIP_LABELS = {
	event_photos: __('Event Photos', 'fair-events-experimental'),
	participants: __('Participants', 'fair-events-experimental'),
	questionnaire_submissions: __(
		'Questionnaire Responses',
		'fair-events-experimental'
	),
};

const ACTION_OPTIONS = [
	{ label: __('Move', 'fair-events-experimental'), value: 'move' },
	{ label: __('Delete', 'fair-events-experimental'), value: 'delete' },
	{ label: __('Skip', 'fair-events-experimental'), value: 'skip' },
];

export default function MergeEventWizard({
	sourceEventDate,
	sourceEventDateId,
	manageEventUrl,
	onCancel,
}) {
	const [activeStep, setActiveStep] = useState(0);

	// Step 1: Target selection.
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [targetEventDateId, setTargetEventDateId] = useState('');

	// Step 2: Preview & configuration.
	const [sourcePreview, setSourcePreview] = useState(null);
	const [targetPreview, setTargetPreview] = useState(null);
	const [loadingPreview, setLoadingPreview] = useState(false);
	const [actions, setActions] = useState({});
	const [deleteSource, setDeleteSource] = useState(false);

	// Step 3: Execution.
	const [executing, setExecuting] = useState(false);
	const [error, setError] = useState(null);
	const [progress, setProgress] = useState('');

	const handleSearch = async (term) => {
		setSearchTerm(term);
		if (!term || term.length < 2) {
			setSearchResults([]);
			return;
		}

		setSearching(true);
		try {
			const results = await apiFetch({
				path: `/fair-events/v1/event-dates?search=${encodeURIComponent(
					term
				)}&per_page=20`,
			});
			// Filter out the source event date.
			setSearchResults(
				results.filter((r) => r.id !== parseInt(sourceEventDateId, 10))
			);
		} catch {
			setSearchResults([]);
		} finally {
			setSearching(false);
		}
	};

	const loadPreviews = async () => {
		setLoadingPreview(true);
		setError(null);
		try {
			const [source, target] = await Promise.all([
				apiFetch({
					path: `/fair-events/v1/event-dates/${sourceEventDateId}/merge-preview`,
				}),
				apiFetch({
					path: `/fair-events/v1/event-dates/${targetEventDateId}/merge-preview`,
				}),
			]);
			setSourcePreview(source);
			setTargetPreview(target);

			// Initialize actions: default to "move" for keys with source data > 0.
			const initialActions = {};
			Object.keys(source.counts).forEach((key) => {
				initialActions[key] = source.counts[key] > 0 ? 'move' : 'skip';
			});
			setActions(initialActions);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load preview.', 'fair-events-experimental')
			);
		} finally {
			setLoadingPreview(false);
		}
	};

	const handleGoToStep2 = () => {
		setActiveStep(1);
		loadPreviews();
	};

	const handleExecute = async () => {
		setExecuting(true);
		setError(null);
		setProgress(__('Merging events...', 'fair-events-experimental'));

		try {
			await apiFetch({
				path: `/fair-events/v1/event-dates/${targetEventDateId}/merge`,
				method: 'POST',
				data: {
					source_id: parseInt(sourceEventDateId, 10),
					actions,
					delete_source: deleteSource,
				},
			});
			setProgress(__('Done! Redirecting...', 'fair-events-experimental'));
			window.location.href = `${manageEventUrl}&event_date_id=${targetEventDateId}`;
		} catch (err) {
			setError(
				err.message ||
					__('Failed to merge events.', 'fair-events-experimental')
			);
			setExecuting(false);
		}
	};

	const selectedTarget = searchResults.find(
		(r) => String(r.id) === String(targetEventDateId)
	);

	const renderStep1 = () => (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Select Target Event', 'fair-events-experimental')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					<p style={{ color: '#666' }}>
						{__(
							'Search for the event date you want to merge this event into. All data from the current event (source) will be moved to the target.',
							'fair-events-experimental'
						)}
					</p>
					<TextControl
						label={__(
							'Search events by title',
							'fair-events-experimental'
						)}
						value={searchTerm}
						onChange={handleSearch}
						placeholder={__(
							'Start typing to search...',
							'fair-events-experimental'
						)}
					/>
					{searching && <Spinner />}
					{searchResults.length > 0 && (
						<SelectControl
							label={__(
								'Select target event',
								'fair-events-experimental'
							)}
							value={targetEventDateId}
							options={[
								{
									label: __(
										'Select...',
										'fair-events-experimental'
									),
									value: '',
								},
								...searchResults.map((r) => ({
									label: `${
										r.title ||
										__(
											'(No title)',
											'fair-events-experimental'
										)
									} — ${r.start_datetime || ''}`,
									value: String(r.id),
								})),
							]}
							onChange={setTargetEventDateId}
						/>
					)}
					{selectedTarget && (
						<Notice status="info" isDismissible={false}>
							{__('Target:', 'fair-events-experimental')}{' '}
							<strong>
								{selectedTarget.title ||
									__(
										'(No title)',
										'fair-events-experimental'
									)}
							</strong>{' '}
							({selectedTarget.start_datetime || ''})
						</Notice>
					)}
				</VStack>
			</CardBody>
		</Card>
	);

	const renderStep2 = () => {
		if (loadingPreview) {
			return <Spinner />;
		}

		if (!sourcePreview || !targetPreview) {
			return null;
		}

		const keys = Object.keys(sourcePreview.counts);

		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>
						{__('Review & Configure', 'fair-events-experimental')}
					</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						<p style={{ color: '#666' }}>
							{__(
								'Review the linked data counts and choose what to do with each type.',
								'fair-events-experimental'
							)}
						</p>

						<table
							className="widefat striped"
							style={{ maxWidth: '700px' }}
						>
							<thead>
								<tr>
									<th>
										{__(
											'Data Type',
											'fair-events-experimental'
										)}
									</th>
									<th style={{ textAlign: 'center' }}>
										{__(
											'Source',
											'fair-events-experimental'
										)}
									</th>
									<th style={{ textAlign: 'center' }}>
										{__(
											'Target',
											'fair-events-experimental'
										)}
									</th>
									<th>
										{__(
											'Action',
											'fair-events-experimental'
										)}
									</th>
								</tr>
							</thead>
							<tbody>
								{keys.map((key) => (
									<tr key={key}>
										<td>
											{RELATIONSHIP_LABELS[key] || key}
										</td>
										<td style={{ textAlign: 'center' }}>
											{sourcePreview.counts[key]}
										</td>
										<td style={{ textAlign: 'center' }}>
											{targetPreview.counts[key]}
										</td>
										<td>
											<SelectControl
												value={actions[key] || 'skip'}
												options={ACTION_OPTIONS}
												onChange={(val) =>
													setActions((prev) => ({
														...prev,
														[key]: val,
													}))
												}
												__nextHasNoMarginBottom
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>

						<CheckboxControl
							label={__(
								'Delete source event after merge',
								'fair-events-experimental'
							)}
							checked={deleteSource}
							onChange={setDeleteSource}
						/>
					</VStack>
				</CardBody>
			</Card>
		);
	};

	const renderStep3 = () => (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Confirm Merge', 'fair-events-experimental')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					<p>
						<strong>
							{__('Source:', 'fair-events-experimental')}
						</strong>{' '}
						{sourceEventDate.title ||
							__('(No title)', 'fair-events-experimental')}{' '}
						({sourceEventDate.start_datetime || ''})
					</p>
					<p>
						<strong>
							{__('Target:', 'fair-events-experimental')}
						</strong>{' '}
						{selectedTarget?.title ||
							__('(No title)', 'fair-events-experimental')}{' '}
						({selectedTarget?.start_datetime || ''})
					</p>

					{Object.entries(actions)
						.filter(([, action]) => action !== 'skip')
						.map(([key, action]) => (
							<p key={key}>
								{RELATIONSHIP_LABELS[key] || key}:{' '}
								<strong>{action}</strong> (
								{sourcePreview?.counts[key] || 0}{' '}
								{sourcePreview?.counts[key] === 1
									? __('item', 'fair-events-experimental')
									: __('items', 'fair-events-experimental')}
								)
							</p>
						))}

					{deleteSource && (
						<Notice status="warning" isDismissible={false}>
							{__(
								'The source event date will be deleted after merge.',
								'fair-events-experimental'
							)}
						</Notice>
					)}

					{!executing && (
						<Button
							variant="primary"
							onClick={handleExecute}
							isDestructive
						>
							{__('Execute Merge', 'fair-events-experimental')}
						</Button>
					)}
				</VStack>
			</CardBody>
		</Card>
	);

	const steps = [
		{
			name: 'select-target',
			title: __('Select Target', 'fair-events-experimental'),
		},
		{
			name: 'review',
			title: __('Review & Configure', 'fair-events-experimental'),
		},
		{ name: 'confirm', title: __('Confirm', 'fair-events-experimental') },
	];

	const currentStep = steps[activeStep];

	const renderCurrentStep = () => {
		switch (currentStep.name) {
			case 'select-target':
				return renderStep1();
			case 'review':
				return renderStep2();
			case 'confirm':
				return renderStep3();
			default:
				return null;
		}
	};

	return (
		<div className="wrap fair-events-manage-event">
			<style>
				{`.fair-events-manage-event .components-card > div:first-child { height: auto; }
.fair-events-manage-event .components-card__body > * { max-width: 700px; }`}
			</style>
			<h1>
				{__('Merge Event', 'fair-events-experimental')}
				{sourceEventDate.title && `: ${sourceEventDate.title}`}
			</h1>

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{executing && (
				<Notice status="info" isDismissible={false}>
					<HStack spacing={2}>
						<Spinner />
						<span>{progress}</span>
					</HStack>
				</Notice>
			)}

			{!executing && (
				<>
					<p style={{ color: '#666' }}>
						{`${__('Step', 'fair-events-experimental')} ${
							activeStep + 1
						} / ${steps.length}: ${currentStep?.title}`}
					</p>
					{renderCurrentStep()}
				</>
			)}

			{!executing && (
				<HStack spacing={2} style={{ marginTop: '16px' }}>
					{activeStep > 0 && (
						<Button
							variant="secondary"
							onClick={() => setActiveStep((s) => s - 1)}
						>
							{__('Back', 'fair-events-experimental')}
						</Button>
					)}
					{activeStep === 0 && (
						<Button
							variant="primary"
							onClick={handleGoToStep2}
							disabled={!targetEventDateId}
						>
							{__('Next', 'fair-events-experimental')}
						</Button>
					)}
					{activeStep === 1 && (
						<Button
							variant="primary"
							onClick={() => setActiveStep(2)}
							disabled={loadingPreview}
						>
							{__('Next', 'fair-events-experimental')}
						</Button>
					)}
					<Button variant="tertiary" onClick={onCancel}>
						{__('Cancel', 'fair-events-experimental')}
					</Button>
				</HStack>
			)}
		</div>
	);
}
