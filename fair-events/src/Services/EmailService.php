<?php
/**
 * Baseline signup confirmation email for standalone fair-events sites
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Sends fair-events' own minimal signup confirmation email. Only used when no
 * companion plugin (fair-audience) is active to send a richer one instead —
 * see FairEvents\Hooks\SignupEmailHooks.
 */
class EmailService {

	/**
	 * Send a signup confirmation email to the buyer.
	 *
	 * @param int    $signup_id     The fair_events_signups row ID, used as the registration reference.
	 * @param int    $event_date_id Event date ID the signup targets.
	 * @param string $name          Buyer name.
	 * @param string $email         Buyer email.
	 * @return bool True on send success.
	 */
	public function send_signup_confirmation( $signup_id, $event_date_id, $name, $email ) {
		$event_title        = __( 'the event', 'fair-events' );
		$event_date_display = '';

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date ) {
			$event = get_post( $event_date->event_id );
			if ( $event ) {
				$event_title = $event->post_title;
			}

			$timestamp = strtotime( $event_date->start_datetime );
			if ( false !== $timestamp ) {
				$event_date_display = wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
			}
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Your registration for %s is confirmed', 'fair-events' ),
			$event_title
		);

		$message = sprintf(
			/* translators: 1: buyer name, 2: event title, 3: event date, 4: registration reference, 5: site name */
			__(
				"Hi %1\$s,\n\nYour registration for %2\$s on %3\$s is confirmed.\n\nRegistration reference: #%4\$s\n\nThanks,\nThe %5\$s Team",
				'fair-events'
			),
			$name,
			$event_title,
			$event_date_display,
			$signup_id,
			$site_name
		);

		return $this->deliver( $email, $subject, $message );
	}

	/**
	 * Send an email — the only wp_mail() call site in fair-events.
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Email subject.
	 * @param string $message Plain-text body.
	 * @return bool True on success.
	 */
	private function deliver( $to, $subject, $message ) {
		return wp_mail( $to, $subject, $message );
	}
}
