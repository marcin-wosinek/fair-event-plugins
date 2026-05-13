/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Notice,
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';

const DEFAULT_TEMPLATE =
	'<b>1 ticket sale on {date}</b> — total: {amount} {currency}\n' +
	'<a href="{participant_url}">{participant_name}</a> — {amount} {currency} (<a href="{event_url}">{event_title}</a>)';

/**
 * Telegram notifications settings tab.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying global notices
 * @return {JSX.Element} The Telegram tab
 */
export default function TelegramTab({ onNotice }) {
	const [enabled, setEnabled] = useState(false);
	const [botToken, setBotToken] = useState('');
	const [chatIds, setChatIds] = useState('');
	const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
	const [includePii, setIncludePii] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState(null);

	useEffect(() => {
		setIsLoading(true);
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setEnabled(!!settings.fair_payment_telegram_enabled);
				setBotToken(settings.fair_payment_telegram_bot_token || '');
				setChatIds(settings.fair_payment_telegram_chat_ids || '');
				setTemplate(
					settings.fair_payment_telegram_template || DEFAULT_TEMPLATE
				);
				setIncludePii(
					settings.fair_payment_telegram_include_pii !== false
				);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Payment] Failed to load Telegram settings:',
					error
				);
				onNotice({
					status: 'error',
					message: __(
						'Failed to load Telegram settings.',
						'fair-payment'
					),
				});
				setIsLoading(false);
			});
	}, []);

	const handleSave = () => {
		setIsSaving(true);
		setTestResult(null);
		apiFetch({
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_payment_telegram_enabled: enabled,
				fair_payment_telegram_bot_token: botToken,
				fair_payment_telegram_chat_ids: chatIds,
				fair_payment_telegram_template: template,
				fair_payment_telegram_include_pii: includePii,
			},
		})
			.then(() => {
				onNotice({
					status: 'success',
					message: __('Telegram settings saved.', 'fair-payment'),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Payment] Failed to save Telegram settings:',
					error
				);
				onNotice({
					status: 'error',
					message:
						__(
							'Failed to save Telegram settings: ',
							'fair-payment'
						) + (error.message || 'Unknown error'),
				});
				setIsSaving(false);
			});
	};

	const handleTest = () => {
		setIsTesting(true);
		setTestResult(null);
		apiFetch({
			path: '/fair-payment/v1/telegram/test',
			method: 'POST',
			data: {
				bot_token: botToken,
				chat_ids: chatIds,
				template,
				include_pii: includePii,
			},
		})
			.then((response) => {
				setTestResult({
					status: 'success',
					message:
						response.message ||
						__('Test message sent.', 'fair-payment'),
				});
				setIsTesting(false);
			})
			.catch((error) => {
				setTestResult({
					status: 'error',
					message:
						error.message ||
						__('Test message failed.', 'fair-payment'),
				});
				setIsTesting(false);
			});
	};

	if (isLoading) {
		return (
			<Card>
				<CardBody>
					<p>{__('Loading Telegram settings…', 'fair-payment')}</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{__('Telegram Notifications', 'fair-payment')}</h2>
				<p style={{ color: '#666', marginBottom: '1.5rem' }}>
					{__(
						'Post a message to a Telegram chat or channel when a transaction is paid.',
						'fair-payment'
					)}
				</p>

				<ToggleControl
					__nextHasNoMarginBottom
					label={__('Enable Telegram notifications', 'fair-payment')}
					checked={enabled}
					onChange={setEnabled}
				/>

				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={__('Bot token', 'fair-payment')}
					help={__(
						'From @BotFather. Stored as plain text in wp_options — anyone with admin access can read it.',
						'fair-payment'
					)}
					type="password"
					value={botToken}
					onChange={setBotToken}
					autoComplete="off"
				/>

				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={__('Chat IDs', 'fair-payment')}
					help={__(
						'Comma-separated. Use a numeric user/chat/channel ID, or @channelname for public channels.',
						'fair-payment'
					)}
					value={chatIds}
					onChange={setChatIds}
				/>

				<TextareaControl
					__nextHasNoMarginBottom
					label={__('Message template', 'fair-payment')}
					help={__(
						'Placeholders: {test_label}, {site_domain}, {date}, {amount}, {currency}, {transaction_id}, {event_title}, {event_url}, {participant_name}, {participant_url}, {participant_email}, {ticket_label}, {activities}, {discounts}. HTML tags <b>, <i>, <a href> are allowed.',
						'fair-payment'
					)}
					rows={5}
					value={template}
					onChange={setTemplate}
				/>

				<ToggleControl
					__nextHasNoMarginBottom
					label={__(
						'Include participant name and email',
						'fair-payment'
					)}
					help={__(
						'Disable to keep PII out of the Telegram channel. {participant_name} and {participant_email} render as empty.',
						'fair-payment'
					)}
					checked={includePii}
					onChange={setIncludePii}
				/>

				<div
					style={{
						marginTop: '1.5rem',
						display: 'flex',
						gap: '0.75rem',
					}}
				>
					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={isSaving}
						disabled={isSaving}
					>
						{__('Save settings', 'fair-payment')}
					</Button>
					<Button
						variant="secondary"
						onClick={handleTest}
						isBusy={isTesting}
						disabled={isTesting || !botToken || !chatIds}
					>
						{__('Send test message', 'fair-payment')}
					</Button>
				</div>

				{testResult && (
					<div style={{ marginTop: '1rem' }}>
						<Notice
							status={testResult.status}
							isDismissible={true}
							onRemove={() => setTestResult(null)}
						>
							{testResult.message}
						</Notice>
					</div>
				)}
			</CardBody>
		</Card>
	);
}
