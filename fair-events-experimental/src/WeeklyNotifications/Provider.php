<?php
/**
 * Weekly notification delivery provider contract.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * A destination type for the weekly summary (Telegram today; WhatsApp,
 * Instagram and others later).
 *
 * Providers format and deliver the summary they are given. Week selection,
 * summary generation, scheduling and duplicate prevention stay in
 * {@see Dispatcher}.
 */
interface Provider {

	/**
	 * Stable provider key, stored with every delivery record.
	 *
	 * @return string
	 */
	public function id();

	/**
	 * Destinations the summary is delivered to.
	 *
	 * @param array $settings         Weekly notification settings.
	 * @param bool  $include_disabled Include destinations of a disabled provider, for test sends.
	 * @return string[] Destination identifiers; empty when the provider is off or unconfigured.
	 */
	public function destinations( array $settings, $include_disabled = false );

	/**
	 * Format a summary as the ordered messages this provider sends.
	 *
	 * @param array $summary Summary from {@see SummaryBuilder::build()}.
	 * @return array Messages in the form {@see send()} accepts.
	 */
	public function split( array $summary );

	/**
	 * Send one message to one destination.
	 *
	 * Must not throw for provider errors, and must never include credentials
	 * in the returned code or message.
	 *
	 * @param string $destination Destination identifier.
	 * @param mixed  $message     One message from {@see split()}.
	 * @return array{state: string, code: string, message: string} State is 'sent',
	 *     'failed' (the provider refused it; nothing was published) or 'uncertain'
	 *     (the request may have been published).
	 */
	public function send( $destination, $message );
}
