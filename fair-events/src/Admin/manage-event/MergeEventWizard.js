/**
 * Merge Event Wizard
 *
 * Multi-step wizard for merging one event_date into another.
 *
 * @package FairEvents
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
	event_photos: __('Event Photos', 'fair-events'),
	participants: __('Participants', 'fair-events'),
	questionnaire_submissions: __('Questionnaire Responses', 'fair-events'),
};

const ACTION_OPTIONS = [
	{ label: __('Move', 'fair-events'), value: 'move' },
	{ label: __('Delete', 'fair-events'), value: 'delete' },
	{ label: __('Skip', 'fair-events'), value: 'skip' },
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
				err.message || __('Failed to load preview.', 'fair-events')
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
		setProgress(__('Merging events...', 'fair-events'));

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
			setProgress(__('Done! Redirecting...', 'fair-events'));
			window.location.href = `${manageEventUrl}&event_date_id=${targetEventDateId}`;
		} catch (err) {
			setError(
				err.message || __('Failed to merge events.', 'fair-events')
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
				<h2>{__('Select Target Event', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					<p style={{ color: '#666' }}>
						{__(
							'Search for the event date you want to merge this event into. All data from the current event (source) will be moved to the target.',
							'fair-events'
						)}
					</p>
					<TextControl
						label={__('Search events by title', 'fair-events')}
						value={searchTerm}
						onChange={handleSearch}
						placeholder={__(
							'Start typing to search...',
							'fair-events'
						)}
					/>
					{searching && <Spinner />}
					{searchResults.length > 0 && (
						<SelectControl
							label={__('Select target event', 'fair-events')}
							value={targetEventDateId}
							options={[
								{
									label: __('Select...', 'fair-events'),
									value: '',
								},
								...searchResults.map((r) => ({
									label: `${
										r.title ||
										__('(No title)', 'fair-events')
									} — ${r.start_datetime || ''}`,
									value: String(r.id),
								})),
							]}
							onChange={setTargetEventDateId}
						/>
					)}
					{selectedTarget && (
						<Notice status="info" isDismissible={false}>
							{__('Target:', 'fair-events')}{' '}
							<strong>
								{selectedTarget.title ||
									__('(No title)', 'fair-events')}
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
					<h2>{__('Review & Configure', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						<p style={{ color: '#666' }}>
							{__(
								'Review the linked data counts and choose what to do with each type.',
								'fair-events'
							)}
						</p>

						<table
							className="widefat striped"
							style={{ maxWidth: '700px' }}
						>
							<thead>
								<tr>
									<th>{__('Data Type', 'fair-events')}</th>
									<th style={{ textAlign: 'center' }}>
										{__('Source', 'fair-events')}
									</th>
									<th style={{ textAlign: 'center' }}>
										{__('Target', 'fair-events')}
									</th>
									<th>{__('Action', 'fair-events')}</th>
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
								'fair-events'
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
				<h2>{__('Confirm Merge', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					<p>
						<strong>{__('Source:', 'fair-events')}</strong>{' '}
						{sourceEventDate.title ||
							__('(No title)', 'fair-events')}{' '}
						({sourceEventDate.start_datetime || ''})
					</p>
					<p>
						<strong>{__('Target:', 'fair-events')}</strong>{' '}
						{selectedTarget?.title ||
							__('(No title)', 'fair-events')}{' '}
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
									? __('item', 'fair-events')
									: __('items', 'fair-events')}
								)
							</p>
						))}

					{deleteSource && (
						<Notice status="warning" isDismissible={false}>
							{__(
								'The source event date will be deleted after merge.',
								'fair-events'
							)}
						</Notice>
					)}

					{!executing && (
						<Button
							variant="primary"
							onClick={handleExecute}
							isDestructive
						>
							{__('Execute Merge', 'fair-events')}
						</Button>
					)}
				</VStack>
			</CardBody>
		</Card>
	);

	const steps = [
		{ name: 'select-target', title: __('Select Target', 'fair-events') },
		{ name: 'review', title: __('Review & Configure', 'fair-events') },
		{ name: 'confirm', title: __('Confirm', 'fair-events') },
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
				{__('Merge Event', 'fair-events')}
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
						{`${__('Step', 'fair-events')} ${activeStep + 1} / ${
							steps.length
						}: ${currentStep?.title}`}
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
							{__('Back', 'fair-events')}
						</Button>
					)}
					{activeStep === 0 && (
						<Button
							variant="primary"
							onClick={handleGoToStep2}
							disabled={!targetEventDateId}
						>
							{__('Next', 'fair-events')}
						</Button>
					)}
					{activeStep === 1 && (
						<Button
							variant="primary"
							onClick={() => setActiveStep(2)}
							disabled={loadingPreview}
						>
							{__('Next', 'fair-events')}
						</Button>
					)}
					<Button variant="tertiary" onClick={onCancel}>
						{__('Cancel', 'fair-events')}
					</Button>
				</HStack>
			)}
		</div>
	);
}
