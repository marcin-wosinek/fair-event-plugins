/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	Spinner,
	ToggleControl,
	SelectControl,
	TextControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	getDigestConfig,
	saveDigestConfig,
	getDigestSources,
	previewDigest,
	sendTestDigest,
} from './weekly-digest-api.js';
import QuicktagsTextarea from './QuicktagsTextarea.js';

const WEEKDAY_LABELS = [
	__('Monday', 'fair-audience'),
	__('Tuesday', 'fair-audience'),
	__('Wednesday', 'fair-audience'),
	__('Thursday', 'fair-audience'),
	__('Friday', 'fair-audience'),
	__('Saturday', 'fair-audience'),
	__('Sunday', 'fair-audience'),
];

/**
 * Weekly Digest admin page.
 *
 * Lets admins configure and preview/test the weekly events digest email.
 *
 * @return {JSX.Element} The weekly digest page
 */
export default function WeeklyDigest() {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [sendingTest, setSendingTest] = useState(false);
	const [notice, setNotice] = useState(null);
	const [config, setConfig] = useState(null);
	const [lastSentWeek, setLastSentWeek] = useState('');
	const [lastRunResult, setLastRunResult] = useState(null);
	const [sources, setSources] = useState([]);
	const [preview, setPreview] = useState(null);
	const introRef = useRef(null);
	const outroRef = useRef(null);

	useEffect(() => {
		Promise.all([getDigestConfig(), getDigestSources()])
			.then(([digest, sourceList]) => {
				setConfig(digest.config);
				setLastSentWeek(digest.last_sent_week);
				setLastRunResult(digest.last_run_result);
				setSources(sourceList);
			})
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						__(
							'Failed to load the weekly digest: ',
							'fair-audience'
						) + (err.message || 'Unknown error'),
				});
			})
			.finally(() => setLoading(false));
	}, []);

	const updateField = (field, value) => {
		setConfig((prev) => ({ ...prev, [field]: value }));
	};

	const handleSave = () => {
		setSaving(true);
		const updatedConfig = {
			...config,
			intro: introRef.current
				? introRef.current.getValue()
				: config.intro,
			outro: outroRef.current
				? outroRef.current.getValue()
				: config.outro,
		};
		saveDigestConfig(updatedConfig)
			.then((response) => {
				setConfig(response.config);
				setNotice({
					status: 'success',
					message: __(
						'Weekly digest settings saved.',
						'fair-audience'
					),
				});
			})
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						__('Failed to save: ', 'fair-audience') +
						(err.message || 'Unknown error'),
				});
			})
			.finally(() => setSaving(false));
	};

	const handlePreview = () => {
		setPreviewing(true);
		setPreview(null);
		previewDigest()
			.then((result) => setPreview(result))
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						__('Failed to build the preview: ', 'fair-audience') +
						(err.message || 'Unknown error'),
				});
			})
			.finally(() => setPreviewing(false));
	};

	const handleSendTest = () => {
		setSendingTest(true);
		sendTestDigest()
			.then((result) => {
				setNotice({
					status: 'success',
					message: sprintf(
						/* translators: %s: email address the test digest was sent to */
						__('Test digest sent to %s.', 'fair-audience'),
						result.sent_to
					),
				});
			})
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						__(
							'Failed to send the test digest: ',
							'fair-audience'
						) + (err.message || 'Unknown error'),
				});
			})
			.finally(() => setSendingTest(false));
	};

	if (loading || !config) {
		return (
			<div className="wrap">
				<h1>{__('Weekly Digest', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	const sourceOptions = [
		{ value: '', label: __('Select a source…', 'fair-audience') },
		...sources.map((source) => ({
			value: source.slug,
			label: source.name,
		})),
	];

	const dayOptions = WEEKDAY_LABELS.map((label, index) => ({
		value: String(index + 1),
		label,
	}));

	return (
		<div className="wrap">
			<h1>{__('Weekly Digest', 'fair-audience')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<Card style={{ marginTop: '1rem' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Settings', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<ToggleControl
						label={__('Send the weekly digest', 'fair-audience')}
						help={__(
							'When enabled, an email with this week’s events is sent automatically on the day and time below.',
							'fair-audience'
						)}
						checked={config.enabled}
						onChange={(value) => updateField('enabled', value)}
					/>

					<SelectControl
						label={__('Event source', 'fair-audience')}
						value={config.source_slug}
						options={sourceOptions}
						onChange={(value) => updateField('source_slug', value)}
					/>

					<SelectControl
						label={__('Day of week', 'fair-audience')}
						value={String(config.day_of_week)}
						options={dayOptions}
						onChange={(value) =>
							updateField('day_of_week', parseInt(value, 10))
						}
					/>

					<TextControl
						label={__('Time of day', 'fair-audience')}
						type="time"
						value={config.time_of_day}
						onChange={(value) => updateField('time_of_day', value)}
					/>

					<SelectControl
						label={__('Which week to include', 'fair-audience')}
						value={config.week_scope}
						options={[
							{
								value: 'current',
								label: __('Current week', 'fair-audience'),
							},
							{
								value: 'next',
								label: __('Next week', 'fair-audience'),
							},
						]}
						onChange={(value) => updateField('week_scope', value)}
					/>

					<ToggleControl
						label={__(
							'Skip sending when the week has no events',
							'fair-audience'
						)}
						checked={config.skip_empty}
						onChange={(value) => updateField('skip_empty', value)}
					/>

					<TextControl
						label={__('Subject', 'fair-audience')}
						help={__(
							'Use {week_start} and {week_end} to insert the week’s dates.',
							'fair-audience'
						)}
						value={config.subject}
						onChange={(value) => updateField('subject', value)}
					/>

					<QuicktagsTextarea
						ref={introRef}
						id="fair-audience-digest-intro"
						label={__('Intro text', 'fair-audience')}
						help={__(
							'Optional HTML shown above the list of events.',
							'fair-audience'
						)}
						defaultValue={config.intro}
					/>

					<QuicktagsTextarea
						ref={outroRef}
						id="fair-audience-digest-outro"
						label={__('Outro text', 'fair-audience')}
						help={__(
							'Optional HTML shown below the list of events.',
							'fair-audience'
						)}
						defaultValue={config.outro}
					/>

					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={saving}
						disabled={saving}
					>
						{__('Save settings', 'fair-audience')}
					</Button>
				</CardBody>
			</Card>

			<Card style={{ marginTop: '1rem' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Last run', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					{!lastSentWeek && !lastRunResult?.timestamp ? (
						<p>
							{__('The digest has not run yet.', 'fair-audience')}
						</p>
					) : (
						<p>
							{sprintf(
								/* translators: 1: ISO week that was last sent, 2: result status (sent, failed, or skipped) */
								__(
									'Last sent for week %1$s — %2$s',
									'fair-audience'
								),
								lastSentWeek || __('n/a', 'fair-audience'),
								lastRunResult?.status ||
									__('unknown', 'fair-audience')
							)}
						</p>
					)}
				</CardBody>
			</Card>

			<Card style={{ marginTop: '1rem' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Preview & test', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<Button
						variant="secondary"
						onClick={handlePreview}
						isBusy={previewing}
						disabled={previewing}
						style={{ marginRight: '8px' }}
					>
						{__('Preview', 'fair-audience')}
					</Button>

					<Button
						variant="secondary"
						onClick={handleSendTest}
						isBusy={sendingTest}
						disabled={sendingTest}
					>
						{__('Send test to me', 'fair-audience')}
					</Button>

					{preview && (
						<div style={{ marginTop: '16px' }}>
							{preview.empty && (
								<Notice status="warning" isDismissible={false}>
									{__(
										'The selected week has no events.',
										'fair-audience'
									)}
								</Notice>
							)}
							<p>
								<strong>
									{__('Subject:', 'fair-audience')}
								</strong>{' '}
								{preview.subject}
							</p>
							<div
								style={{
									border: '1px solid #ddd',
									padding: '16px',
									background: '#fff',
								}}
								dangerouslySetInnerHTML={{
									__html: preview.html,
								}}
							/>
						</div>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
