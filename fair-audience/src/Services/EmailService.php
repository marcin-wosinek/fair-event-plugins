<?php
/**
 * Email Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\PollRepository;
use FairAudience\Database\PollAccessKeyRepository;
use FairAudience\Database\GalleryAccessKeyRepository;
use FairAudience\Database\EventSignupAccessKeyRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Service for sending poll invitation emails.
 */
class EmailService {

	/**
	 * Poll repository instance.
	 *
	 * @var PollRepository
	 */
	private $poll_repository;

	/**
	 * Poll access key repository instance.
	 *
	 * @var PollAccessKeyRepository
	 */
	private $access_key_repository;

	/**
	 * Gallery access key repository instance.
	 *
	 * @var GalleryAccessKeyRepository
	 */
	private $gallery_access_key_repository;

	/**
	 * Event participant repository instance.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repository;

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->poll_repository               = new PollRepository();
		$this->access_key_repository         = new PollAccessKeyRepository();
		$this->gallery_access_key_repository = new GalleryAccessKeyRepository();
		$this->event_participant_repository  = new EventParticipantRepository();
		$this->participant_repository        = new ParticipantRepository();
	}

	/**
	 * Send poll invitation to a single participant.
	 *
	 * @param object $poll         Poll object.
	 * @param object $event        Event post object.
	 * @param object $participant  Participant object.
	 * @param string $access_token Access token (not hashed).
	 * @param string $custom_message Optional custom message.
	 * @return bool Success.
	 */
	public function send_poll_invitation( $poll, $event, $participant, $access_token, $custom_message = '' ) {
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build poll URL.
		$poll_url = add_query_arg( 'poll_key', $access_token, home_url( '/' ) );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Quick question about %s', 'fair-audience' ),
			$event->post_title
		);

		// Build HTML message body.
		$message = '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $participant->name ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: event title */
								esc_html__( "We'd love to hear from you about %s!", 'fair-audience' ),
								'<strong>' . esc_html( $event->post_title ) . '</strong>'
							) . '
							</p>';

		if ( ! empty( $custom_message ) ) {
			$message .= '
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . nl2br( esc_html( $custom_message ) ) . '
							</p>';
		}

		$message .= '
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( 'Please take a moment to answer our quick poll:', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $poll_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Answer Poll', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
										esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
										'<br>',
										esc_html( $site_name )
									) . '
							</p>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">
								' . esc_html__( 'If the button above doesn\'t work, copy and paste this link:', 'fair-audience' ) . '
							</p>
							<p style="margin: 0; word-break: break-all;">
								<a href="' . esc_url( $poll_url ) . '" style="color: #0073aa;">' . esc_url( $poll_url ) . '</a>
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		// Set email content type to HTML.
		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		// Send email.
		$result = wp_mail( $participant->email, $subject, $message );

		// Reset content type to avoid conflicts.
		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send poll invitations to all event participants (bulk).
	 *
	 * @param int    $poll_id Poll ID.
	 * @param string $subject Optional custom subject.
	 * @param string $message Optional custom message.
	 * @return array Results array with 'sent' and 'failed' keys.
	 */
	public function send_bulk_invitations( $poll_id, $subject = '', $message = '' ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'   => array(),
			'failed' => array(),
		);

		// Get poll.
		$poll = $this->poll_repository->get_by_id( $poll_id );

		if ( ! $poll ) {
			$results['failed'][] = array(
				'email'  => '',
				'reason' => __( 'Poll not found.', 'fair-audience' ),
			);
			return $results;
		}

		// Get event.
		$event = get_post( $poll->event_id );

		if ( ! $event ) {
			$results['failed'][] = array(
				'email'  => '',
				'reason' => __( 'Event not found.', 'fair-audience' ),
			);
			return $results;
		}

		// Generate access keys for all event participants.
		$this->access_key_repository->generate_keys_for_event_participants( $poll_id, $poll->event_id );

		// Get all access keys for this poll.
		$access_keys = $this->access_key_repository->get_by_poll( $poll_id );

		foreach ( $access_keys as $access_key ) {
			// Skip participants who have already responded.
			if ( 'responded' === $access_key->status ) {
				continue;
			}

			// Get participant.
			$participant = $this->participant_repository->get_by_id( $access_key->participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			// Send invitation.
			$success = $this->send_poll_invitation( $poll, $event, $participant, $access_key->token, $message );

			if ( $success ) {
				$results['sent'][] = $participant->email;

				// Update sent_at timestamp.
				$access_key->sent_at = current_time( 'mysql' );
				$access_key->save();
			} else {
				$results['failed'][] = array(
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}

	/**
	 * Send gallery invitation to a single participant.
	 *
	 * @param object $event        Event post object.
	 * @param object $participant  Participant object.
	 * @param string $access_token Access token (not hashed).
	 * @param string $custom_message Optional custom message.
	 * @return bool Success.
	 */
	public function send_gallery_invitation( $event, $participant, $access_token, $custom_message = '' ) {
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build gallery URL.
		$gallery_url = add_query_arg( 'gallery_key', $access_token, home_url( '/' ) );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Photos from %s are ready!', 'fair-audience' ),
			$event->post_title
		);

		// Build HTML message body.
		$message = '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $participant->name ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: event title */
								esc_html__( 'The photos from %s are now available for you to view and like!', 'fair-audience' ),
								'<strong>' . esc_html( $event->post_title ) . '</strong>'
							) . '
							</p>';

		if ( ! empty( $custom_message ) ) {
			$message .= '
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . nl2br( esc_html( $custom_message ) ) . '
							</p>';
		}

		$message .= '
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( 'Click the button below to browse the gallery and let us know which photos you like best:', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $gallery_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'View Gallery', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
										esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
										'<br>',
										esc_html( $site_name )
									) . '
							</p>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">
								' . esc_html__( 'If the button above doesn\'t work, copy and paste this link:', 'fair-audience' ) . '
							</p>
							<p style="margin: 0; word-break: break-all;">
								<a href="' . esc_url( $gallery_url ) . '" style="color: #0073aa;">' . esc_url( $gallery_url ) . '</a>
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		// Set email content type to HTML.
		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		// Send email.
		$result = wp_mail( $participant->email, $subject, $message );

		// Reset content type to avoid conflicts.
		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send gallery invitations to event participants (bulk).
	 *
	 * @param int    $event_id Event ID.
	 * @param string $custom_message Optional custom message.
	 * @param array  $participant_ids Optional array of participant IDs to send to. If empty, sends to all.
	 * @return array Results array with 'sent' and 'failed' keys.
	 */
	public function send_bulk_gallery_invitations( $event_id, $custom_message = '', $participant_ids = array() ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'   => array(),
			'failed' => array(),
		);

		// Get event.
		$event = get_post( $event_id );

		if ( ! $event ) {
			$results['failed'][] = array(
				'email'  => '',
				'reason' => __( 'Event not found.', 'fair-audience' ),
			);
			return $results;
		}

		// Generate access keys for all event participants (or just the selected ones).
		$this->gallery_access_key_repository->generate_keys_for_event_participants( $event_id, $participant_ids );

		// Get all access keys for this event.
		$access_keys = $this->gallery_access_key_repository->get_by_event( $event_id );

		foreach ( $access_keys as $access_key ) {
			// Skip participants not in the filter list (if provided).
			if ( ! empty( $participant_ids ) && ! in_array( $access_key->participant_id, $participant_ids, true ) ) {
				continue;
			}
			// Get participant.
			$participant = $this->participant_repository->get_by_id( $access_key->participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			// Send invitation.
			$success = $this->send_gallery_invitation( $event, $participant, $access_key->token, $custom_message );

			if ( $success ) {
				$results['sent'][] = $participant->email;

				// Update sent_at timestamp.
				$access_key->mark_as_sent();
			} else {
				$results['failed'][] = array(
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}

	/**
	 * Send email confirmation for mailing signup.
	 *
	 * @param Participant $participant Participant object.
	 * @param string      $token       Confirmation token.
	 * @return bool Success.
	 */
	public function send_confirmation_email( $participant, $token ) {
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build confirmation URL.
		$confirm_url = add_query_arg( 'confirm_email_key', $token, home_url( '/' ) );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Confirm your subscription to %s', 'fair-audience' ),
			$site_name
		);

		// Build HTML message body.
		$message = '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $participant->name ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( 'Thank you for signing up for our mailing list! Please confirm your email address by clicking the button below.', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $confirm_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Confirm Email', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . esc_html__( 'This link will expire in 48 hours.', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . esc_html__( "If you didn't sign up for this mailing list, you can safely ignore this email.", 'fair-audience' ) . '
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
									esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
									'<br>',
									esc_html( $site_name )
								) . '
							</p>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">
								' . esc_html__( "If the button above doesn't work, copy and paste this link:", 'fair-audience' ) . '
							</p>
							<p style="margin: 0; word-break: break-all;">
								<a href="' . esc_url( $confirm_url ) . '" style="color: #0073aa;">' . esc_url( $confirm_url ) . '</a>
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		// Set email content type to HTML.
		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		// Send email.
		$result = wp_mail( $participant->email, $subject, $message );

		// Reset content type to avoid conflicts.
		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send event signup link email.
	 *
	 * @param object      $event        Event post object.
	 * @param Participant $participant  Participant object.
	 * @param string      $token        Signup access token.
	 * @return bool Success.
	 */
	public function send_signup_link_email( $event, $participant, $token ) {
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build signup URL with token.
		$signup_url = add_query_arg( 'signup_token', $token, get_permalink( $event->ID ) );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Sign up for %s', 'fair-audience' ),
			$event->post_title
		);

		// Build HTML message body.
		$message = '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $participant->name ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf(
									/* translators: %s: event title */
								esc_html__( 'You requested a signup link for %s.', 'fair-audience' ),
								'<strong>' . esc_html( $event->post_title ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( 'Click the button below to sign up for the event:', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $signup_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Sign Up Now', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . esc_html__( "If you didn't request this link, you can safely ignore this email.", 'fair-audience' ) . '
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
									esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
									'<br>',
									esc_html( $site_name )
								) . '
							</p>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">
								' . esc_html__( "If the button above doesn't work, copy and paste this link:", 'fair-audience' ) . '
							</p>
							<p style="margin: 0; word-break: break-all;">
								<a href="' . esc_url( $signup_url ) . '" style="color: #0073aa;">' . esc_url( $signup_url ) . '</a>
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		// Set email content type to HTML.
		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		// Send email.
		$result = wp_mail( $participant->email, $subject, $message );

		// Reset content type to avoid conflicts.
		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}
}
