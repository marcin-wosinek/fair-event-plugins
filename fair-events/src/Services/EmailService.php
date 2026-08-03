<?php
/**
 * Baseline signup confirmation email for standalone fair-events sites
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEventsShared\Money;
use FairEventsShared\Notifications\SignupConfirmationEmail;

defined( 'WPINC' ) || die;

/**
 * Sends fair-events' own baseline signup confirmation email, built on the
 * same shared formatter fair-audience uses. Only used when no companion
 * plugin (fair-audience) is active to send a richer one instead — see
 * FairEvents\Hooks\SignupEmailHooks.
 */
class EmailService {

	/**
	 * Send a signup confirmation email to the buyer.
	 *
	 * @param int    $signup_id      The fair_events_signups row ID, used as the registration reference.
	 * @param int    $event_date_id  Event date ID the signup targets.
	 * @param string $name           Buyer name.
	 * @param string $email          Buyer email.
	 * @param int    $ticket_type_id Ticket type ID shown in the email. Pass 0 to omit.
	 * @param float  $amount         Amount paid, shown on paid signups. Pass 0 to omit.
	 * @return bool True on send success.
	 */
	public function send_signup_confirmation( $signup_id, $event_date_id, $name, $email, $ticket_type_id = 0, $amount = 0.0 ) {
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

		$ticket_type_name = '';
		if ( $ticket_type_id > 0 && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type ) {
				$ticket_type_name = $ticket_type->name;
			}
		}

		$payment_amount_display = $amount > 0 ? Money::format_display( (float) $amount ) : '';

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$subject_template =
			/* translators: %s: event title */
			__( 'Your registration for %s is confirmed', 'fair-events' );

		$subject = SignupConfirmationEmail::subject( $subject_template, $event_title );
		$message = SignupConfirmationEmail::html(
			array(
				'event_title'                  => esc_html( $event_title ),
				'participant_name'             => esc_html( $name ),
				'site_name'                    => esc_html( $site_name ),
				'event_date_display'           => esc_html( $event_date_display ),
				'registration_reference'       => '#' . $signup_id,
				'ticket_type_name'             => esc_html( $ticket_type_name ),
				'payment_amount_display'       => esc_html( $payment_amount_display ),
				'option_names'                 => array(),
				'answers_html'                 => '',
				/* translators: %s: buyer first name */
				'greeting_template'            => esc_html__( 'Hi %s,', 'fair-events' ),
				'confirmation_sentence'        => sprintf(
					/* translators: %s: event title */
					esc_html__( 'Your registration for %s is confirmed.', 'fair-events' ),
					'<strong>' . esc_html( $event_title ) . '</strong>'
				),
				'event_date_label'             => esc_html__( 'Event date:', 'fair-events' ),
				'registration_reference_label' => esc_html__( 'Registration reference:', 'fair-events' ),
				'ticket_type_label'            => esc_html__( 'Ticket type:', 'fair-events' ),
				'amount_paid_label'            => esc_html__( 'Amount paid:', 'fair-events' ),
				'selected_options_label'       => esc_html__( 'Selected options:', 'fair-events' ),
				'your_answers_label'           => esc_html__( 'Your answers:', 'fair-events' ),
				/* translators: 1: line break, 2: site name */
				'sign_off_template'            => esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-events' ),
			)
		);

		return $this->deliver( $email, $subject, $message );
	}

	/**
	 * Send a payment-failed email to the buyer, built on the same shared
	 * formatter as send_signup_confirmation(). Links back to the event page
	 * with a plain link — not a token-based resume link — since the
	 * fair-events signup flow already shows an in-page retry state when the
	 * buyer returns to a page with a failed attempt (see #1373).
	 *
	 * @param int    $signup_id      The fair_events_signups row ID.
	 * @param int    $event_date_id  Event date ID the signup targeted.
	 * @param string $name           Buyer name.
	 * @param string $email          Buyer email.
	 * @param int    $ticket_type_id Ticket type ID shown in the email. Pass 0 to omit.
	 * @param float  $amount         Amount attempted, shown when known. Pass 0 to omit.
	 * @return bool True on send success.
	 */
	public function send_signup_payment_failed( $signup_id, $event_date_id, $name, $email, $ticket_type_id = 0, $amount = 0.0 ) {
		$event_title        = __( 'the event', 'fair-events' );
		$event_date_display = '';
		$event_url          = home_url( '/' );

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date ) {
			$event = get_post( $event_date->get_resolved_event_id() );
			if ( $event ) {
				$event_title = $event->post_title;
			}

			$display_url = $event_date->get_display_url();
			if ( $display_url ) {
				$event_url = $display_url;
			}

			$timestamp = strtotime( $event_date->start_datetime );
			if ( false !== $timestamp ) {
				$event_date_display = wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
			}
		}

		$ticket_type_name = '';
		if ( $ticket_type_id > 0 && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type ) {
				$ticket_type_name = $ticket_type->name;
			}
		}

		$payment_amount_display = $amount > 0 ? Money::format_display( (float) $amount ) : '';

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$subject_template =
			/* translators: %s: event title */
			__( 'Payment didn’t go through — %s', 'fair-events' );

		$subject = SignupConfirmationEmail::subject( $subject_template, $event_title );
		$message = SignupConfirmationEmail::html(
			array(
				'event_title'                  => esc_html( $event_title ),
				'participant_name'             => esc_html( $name ),
				'site_name'                    => esc_html( $site_name ),
				'event_date_display'           => esc_html( $event_date_display ),
				'registration_reference'       => '#' . $signup_id,
				'ticket_type_name'             => esc_html( $ticket_type_name ),
				'payment_amount_display'       => esc_html( $payment_amount_display ),
				'option_names'                 => array(),
				'answers_html'                 => '',
				'action_url'                   => esc_url( $event_url ),
				/* translators: %s: buyer first name */
				'greeting_template'            => esc_html__( 'Hi %s,', 'fair-events' ),
				'confirmation_sentence'        => sprintf(
					/* translators: %s: event title */
					esc_html__( 'Your payment for %s didn’t go through, so the registration wasn’t completed.', 'fair-events' ),
					'<strong>' . esc_html( $event_title ) . '</strong>'
				),
				'event_date_label'             => esc_html__( 'Event date:', 'fair-events' ),
				'registration_reference_label' => esc_html__( 'Registration reference:', 'fair-events' ),
				'ticket_type_label'            => esc_html__( 'Ticket type:', 'fair-events' ),
				'amount_paid_label'            => esc_html__( 'Amount:', 'fair-events' ),
				'selected_options_label'       => esc_html__( 'Selected options:', 'fair-events' ),
				'your_answers_label'           => esc_html__( 'Your answers:', 'fair-events' ),
				'action_label'                 => esc_html__( 'Return to the event page to try again', 'fair-events' ),
				/* translators: 1: line break, 2: site name */
				'sign_off_template'            => esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-events' ),
			)
		);

		return $this->deliver( $email, $subject, $message );
	}

	/**
	 * Send an email — the only wp_mail() call site in fair-events.
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Email subject.
	 * @param string $message Full HTML body.
	 * @return bool True on success.
	 */
	private function deliver( $to, $subject, $message ) {
		$content_type = static function () {
			return 'text/html';
		};

		add_filter( 'wp_mail_content_type', $content_type );
		$result = wp_mail( $to, $subject, $message );
		remove_filter( 'wp_mail_content_type', $content_type );

		return $result;
	}
}
