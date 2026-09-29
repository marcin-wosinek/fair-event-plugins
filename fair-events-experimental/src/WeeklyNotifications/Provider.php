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
 * Providers only deliver text they are given. Week selection, summary
 * generation, scheduling and duplicate prevention stay in {@see Dispatcher}.
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
	 * Split a summary into the ordered messages this provider can send.
	 *
	 * @param string $text Summary text.
	 * @return string[]
	 */
	public function split( $text );

	/**
	 * Send one message to one destination.
	 *
	 * Must not throw for provider errors, and must never include credentials
	 * in the returned code or message.
	 *
	 * @param string $destination Destination identifier.
	 * @param string $text        Message text.
	 * @return array{state: string, code: string, message: string} State is 'sent',
	 *     'failed' (the provider refused it; nothing was published) or 'uncertain'
	 *     (the request may have been published).
	 */
	public function send( $destination, $text );
}
