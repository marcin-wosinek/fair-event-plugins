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
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\GroupParticipantRepository;
use FairAudience\Database\ExtraMessageRepository;
use FairAudience\Database\FeeRepository;
use FairAudience\Database\FeePaymentRepository;
use FairAudience\Database\FeeAuditLogRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailType;
use FairAudience\Services\AudienceSignupToken;
use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Services\ParticipantToken;
use FairAudience\Services\FeePaymentToken;

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
	 * Group participant repository instance.
	 *
	 * @var GroupParticipantRepository
	 */
	private $group_participant_repository;

	/**
	 * Cached active extra messages per event (lazy-loaded).
	 *
	 * @var array
	 */
	private $active_extra_messages_cache = array();

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->poll_repository               = new PollRepository();
		$this->access_key_repository         = new PollAccessKeyRepository();
		$this->gallery_access_key_repository = new GalleryAccessKeyRepository();
		$this->event_participant_repository  = new EventParticipantRepository();
		$this->participant_repository        = new ParticipantRepository();
		$this->group_participant_repository  = new GroupParticipantRepository();
	}

	/**
	 * Get active extra messages for an event (lazy-loaded, cached per event).
	 *
	 * @param int $event_id Event post ID.
	 * @return \FairAudience\Models\ExtraMessage[] Array of active extra messages.
	 */
	private function get_active_extra_messages( $event_id ) {
		if ( ! isset( $this->active_extra_messages_cache[ $event_id ] ) ) {
			$repository                                     = new ExtraMessageRepository();
			$this->active_extra_messages_cache[ $event_id ] = $repository->get_active_for_event( $event_id );
		}
		return $this->active_extra_messages_cache[ $event_id ];
	}

	/**
	 * Check if a participant can receive a specific type of email.
	 *
	 * @param Participant $participant The participant to check.
	 * @param string      $email_type  The email type (EmailType::MINIMAL or EmailType::MARKETING).
	 * @return bool True if the participant can receive the email.
	 */
	private function can_receive_email( Participant $participant, string $email_type ): bool {
		// Minimal emails are always allowed.
		if ( EmailType::MINIMAL === $email_type ) {
			return true;
		}

		// Marketing emails require explicit opt-in.
		return 'marketing' === $participant->email_profile;
	}

	/**
	 * Check if a participant has a valid email address.
	 *
	 * @param Participant $participant The participant to check.
	 * @return bool True if the participant has a non-empty email.
	 */
	private function has_valid_email( Participant $participant ): bool {
		return ! empty( $participant->email );
	}

	/**
	 * Get unique participant IDs for an array of group IDs.
	 *
	 * @param array $group_ids Array of group IDs.
	 * @return array Array of unique participant IDs.
	 */
	private function get_participant_ids_for_groups( $group_ids ) {
		if ( empty( $group_ids ) ) {
			return array();
		}

		$participant_ids = array();
		foreach ( $group_ids as $group_id ) {
			$members = $this->group_participant_repository->get_by_group( $group_id );
			foreach ( $members as $member ) {
				$participant_ids[] = $member->participant_id;
			}
		}

		return array_unique( $participant_ids );
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
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

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
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
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
					'name'   => $participant->name,
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
	public function send_gallery_invitation( $event, $participant, $access_token, $custom_message = '', $disabled_extra_message_ids = array() ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

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
							</p>';

		// Append active extra messages after CTA.
		$extra_messages = $this->get_active_extra_messages( $event->ID );
		if ( ! empty( $disabled_extra_message_ids ) ) {
			$extra_messages = array_filter(
				$extra_messages,
				function ( $msg ) use ( $disabled_extra_message_ids ) {
					return ! in_array( $msg->id, $disabled_extra_message_ids, true );
				}
			);
		}
		foreach ( $extra_messages as $extra_msg ) {
			$message .= '
							<div style="margin: 0 0 20px 0; font-size: 16px;">
								' . wp_kses_post( $extra_msg->content ) . '
							</div>';
		}

		$message .= '
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
	 * @param int    $event_date_id Event date ID.
	 * @param string $custom_message Optional custom message.
	 * @param array  $participant_ids Optional array of participant IDs to send to. If empty, sends to all.
	 * @param array  $disabled_extra_message_ids Extra message IDs to exclude.
	 * @param int    $event_id Event ID (resolved from event_date_id if 0).
	 * @return array Results array with 'sent' and 'failed' keys.
	 */
	public function send_bulk_gallery_invitations( $event_date_id, $custom_message = '', $participant_ids = array(), $disabled_extra_message_ids = array(), $event_id = 0 ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'   => array(),
			'failed' => array(),
		);

		// Resolve event_id from event_date_id if not provided.
		if ( empty( $event_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_id = (int) $event_date->event_id;
			}
		}

		// Get event.
		$event = get_post( $event_id );

		if ( ! $event ) {
			$results['failed'][] = array(
				'email'  => '',
				'reason' => __( 'Event not found.', 'fair-audience' ),
			);
			return $results;
		}

		// Generate access keys for event date participants (or just the selected ones).
		$this->gallery_access_key_repository->generate_keys_for_event_date_participants( $event_date_id, $participant_ids, $event_id );

		// Get all access keys for this event date.
		$access_keys = $this->gallery_access_key_repository->get_by_event_date( $event_date_id );

		foreach ( $access_keys as $access_key ) {
			// Skip participants not in the filter list (if provided).
			if ( ! empty( $participant_ids ) && ! in_array( $access_key->participant_id, $participant_ids, true ) ) {
				continue;
			}
			// Get participant.
			$participant = $this->participant_repository->get_by_id( $access_key->participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
				);
				continue;
			}

			// Send invitation.
			$success = $this->send_gallery_invitation( $event, $participant, $access_key->token, $custom_message, $disabled_extra_message_ids );

			if ( $success ) {
				$results['sent'][] = $participant->email;

				// Update sent_at timestamp.
				$access_key->mark_as_sent();
			} else {
				$results['failed'][] = array(
					'name'   => $participant->name,
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
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

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
	 * Send audience signup answers confirmation email.
	 *
	 * @param Participant $participant   Participant object.
	 * @param int         $submission_id Submission ID.
	 * @param array       $answers       Questionnaire answers array.
	 * @param int         $post_id       Post ID containing the signup block.
	 * @return bool Success.
	 */
	public function send_audience_signup_answers_email( Participant $participant, int $submission_id, array $answers, int $post_id ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build edit URL.
		$edit_url = AudienceSignupToken::get_url( $submission_id, $post_id );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Your signup answers — %s', 'fair-audience' ),
			$site_name
		);

		// Build answers table rows.
		$answers_html = '';
		foreach ( $answers as $answer ) {
			$question_text = esc_html( $answer['question_text'] ?? '' );
			$answer_value  = $answer['answer_value'] ?? '';

			// Checkbox values are JSON-encoded arrays — display comma-separated.
			$decoded = json_decode( $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$answers_html .= '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . $question_text . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( $answer_value ) . '</td>
			</tr>';
		}

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
								' . esc_html__( 'Thank you for signing up! Here are the answers you submitted:', 'fair-audience' ) . '
							</p>

							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px 0; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $answers_html . '
							</table>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $edit_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Edit Your Answers', 'fair-audience' ) . '
								</a>
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
								<a href="' . esc_url( $edit_url ) . '" style="color: #0073aa;">' . esc_url( $edit_url ) . '</a>
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
	 * @param object      $event      Event post object.
	 * @param Participant $participant Participant object.
	 * @param string      $signup_url Full signup URL with participant token.
	 * @return bool Success.
	 */
	public function send_signup_link_email( $event, $participant, $signup_url ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build manage subscription URL for unsubscribe link.
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

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
							<p style="margin: 0 0 15px 0; word-break: break-all;">
								<a href="' . esc_url( $signup_url ) . '" style="color: #0073aa;">' . esc_url( $signup_url ) . '</a>
							</p>
							<p style="margin: 0; border-top: 1px solid #e0e0e0; padding-top: 15px;">
								' . esc_html__( "Don't want to receive event invitations?", 'fair-audience' ) . '
								<a href="' . esc_url( $manage_subscription_url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your preferences', 'fair-audience' ) . '</a>
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
	 * Replace participant-specific placeholders in email content.
	 *
	 * @param string      $content       Email content (HTML).
	 * @param Participant $participant   Participant object.
	 * @param int         $event_date_id Event date ID (0 if not linked to an event date).
	 * @return string Processed content.
	 */
	private function replace_placeholders( $content, $participant, $event_date_id = 0 ) {
		if ( false !== strpos( $content, '{photo_upload_url}' ) ) {
			$token = ParticipantToken::generate( $participant->id, $event_date_id );
			$url   = add_query_arg( 'participant_token', $token, home_url( '/' ) );
			$url   = add_query_arg( 'photo_upload', '1', $url );

			$content = str_replace( '{photo_upload_url}', esc_url( $url ), $content );
		}

		if ( false !== strpos( $content, '{manage_subscription_url}' ) ) {
			$url = ManageSubscriptionToken::get_url( $participant->id );

			$content = str_replace( '{manage_subscription_url}', esc_url( $url ), $content );
		}

		if ( preg_match_all( '/\{token_link_(\d+)\}/', $content, $matches ) ) {
			foreach ( $matches[1] as $index => $post_id ) {
				$url     = ParticipantToken::get_url( $participant->id, $event_date_id, (int) $post_id );
				$content = str_replace( $matches[0][ $index ], esc_url( $url ), $content );
			}
		}

		return $content;
	}

	/**
	 * Send a custom mail to a single participant.
	 *
	 * @param object      $event         Event post object.
	 * @param Participant $participant   Participant object.
	 * @param string      $subject       Email subject.
	 * @param string      $content       Email content (HTML).
	 * @param int         $event_date_id Event date ID for placeholder replacement.
	 * @return bool Success.
	 */
	public function send_custom_mail( $event, $participant, $subject, $content, $event_date_id = 0 ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		// Replace participant-specific placeholders.
		$content = $this->replace_placeholders( $content, $participant, $event_date_id );

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build manage subscription URL for unsubscribe link.
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

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

							<div style="margin: 0 0 20px 0; font-size: 16px;">
								' . wp_kses_post( $content ) . '
							</div>

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
							<p style="margin: 0;">
								' . esc_html__( "Don't want to receive these emails?", 'fair-audience' ) . '
								<a href="' . esc_url( $manage_subscription_url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your preferences', 'fair-audience' ) . '</a>
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
	 * Send bulk custom mail to event participants.
	 *
	 * @param int    $event_id     Event ID.
	 * @param string $subject      Email subject.
	 * @param string $content      Email content (HTML).
	 * @param bool   $is_marketing Whether to filter by marketing consent.
	 * @param array  $labels               Labels to include (e.g. 'signed_up', 'collaborator', 'interested').
	 * @param array  $skip_participant_ids  Participant IDs to skip.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_custom_mail( $event_id, $subject, $content, $is_marketing = true, $labels = array( 'signed_up', 'collaborator' ), $skip_participant_ids = array(), $event_date_id = 0, $group_ids = array() ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'    => array(),
			'failed'  => array(),
			'skipped' => array(),
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

		$group_participant_ids = $this->get_participant_ids_for_groups( $group_ids );

		// Get participants signed up for this event.
		$event_participants = $this->event_participant_repository->get_by_event( $event_id );

		foreach ( $event_participants as $ep ) {
			// Only send to participants with matching labels.
			if ( ! in_array( $ep->label, $labels, true ) ) {
				continue;
			}

			// Filter by group membership.
			if ( ! empty( $group_ids ) && ! in_array( $ep->participant_id, $group_participant_ids, true ) ) {
				continue;
			}

			// Skip manually excluded participants.
			if ( ! empty( $skip_participant_ids ) && in_array( $ep->participant_id, $skip_participant_ids, true ) ) {
				$participant          = $this->participant_repository->get_by_id( $ep->participant_id );
				$results['skipped'][] = array(
					'name'   => $participant ? $participant->name : '',
					'email'  => $participant ? $participant->email : '',
					'reason' => __( 'Manually skipped.', 'fair-audience' ),
				);
				continue;
			}

			$participant = $this->participant_repository->get_by_id( $ep->participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
				);
				continue;
			}

			// Check marketing consent if needed.
			if ( $is_marketing && ! $this->can_receive_email( $participant, EmailType::MARKETING ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'Participant opted out of marketing emails.', 'fair-audience' ),
				);
				continue;
			}

			// Send custom mail.
			$success = $this->send_custom_mail( $event, $participant, $subject, $content, $event_date_id );

			if ( $success ) {
				$results['sent'][] = $participant->email;
			} else {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}

	/**
	 * Send bulk custom mail to all audience members.
	 *
	 * @param string $subject      Email subject.
	 * @param string $content      Email content (HTML).
	 * @param bool   $is_marketing         Whether to filter by marketing consent.
	 * @param array  $skip_participant_ids  Participant IDs to skip.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_custom_mail_to_all( $subject, $content, $is_marketing = true, $skip_participant_ids = array(), $group_ids = array() ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'    => array(),
			'failed'  => array(),
			'skipped' => array(),
		);

		$participants          = $this->participant_repository->get_all();
		$group_participant_ids = $this->get_participant_ids_for_groups( $group_ids );

		foreach ( $participants as $participant ) {
			// Filter by group membership.
			if ( ! empty( $group_ids ) && ! in_array( $participant->id, $group_participant_ids, true ) ) {
				continue;
			}

			// Skip manually excluded participants.
			if ( ! empty( $skip_participant_ids ) && in_array( $participant->id, $skip_participant_ids, true ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'Manually skipped.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
				);
				continue;
			}

			// Check marketing consent if needed.
			if ( $is_marketing && ! $this->can_receive_email( $participant, EmailType::MARKETING ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'Participant opted out of marketing emails.', 'fair-audience' ),
				);
				continue;
			}

			// Send custom mail (no event context).
			$success = $this->send_custom_mail_without_event( $participant, $subject, $content );

			if ( $success ) {
				$results['sent'][] = $participant->email;
			} else {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}

	/**
	 * Send a custom mail to a single participant without event context.
	 *
	 * @param Participant $participant Participant object.
	 * @param string      $subject     Email subject.
	 * @param string      $content     Email content (HTML).
	 * @return bool Success.
	 */
	public function send_custom_mail_without_event( $participant, $subject, $content ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		// Replace participant-specific placeholders.
		$content = $this->replace_placeholders( $content, $participant );

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build manage subscription URL for unsubscribe link.
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

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

							<div style="margin: 0 0 20px 0; font-size: 16px;">
								' . wp_kses_post( $content ) . '
							</div>

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
							<p style="margin: 0;">
								' . esc_html__( "Don't want to receive these emails?", 'fair-audience' ) . '
								<a href="' . esc_url( $manage_subscription_url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your preferences', 'fair-audience' ) . '</a>
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
	 * Preview recipients for bulk custom mail to event participants.
	 *
	 * @param int   $event_id     Event ID.
	 * @param bool  $is_marketing Whether to filter by marketing consent.
	 * @param array $labels       Labels to include.
	 * @return array List of recipient info arrays.
	 */
	public function preview_custom_mail_recipients( $event_id, $is_marketing = true, $labels = array( 'signed_up', 'collaborator' ), $group_ids = array() ) {
		$recipients = array();

		$event = get_post( $event_id );
		if ( ! $event ) {
			return $recipients;
		}

		$group_participant_ids = $this->get_participant_ids_for_groups( $group_ids );

		$event_participants = $this->event_participant_repository->get_by_event( $event_id );

		foreach ( $event_participants as $ep ) {
			if ( ! in_array( $ep->label, $labels, true ) ) {
				continue;
			}

			if ( ! empty( $group_ids ) && ! in_array( $ep->participant_id, $group_participant_ids, true ) ) {
				continue;
			}

			$participant = $this->participant_repository->get_by_id( $ep->participant_id );
			if ( ! $participant ) {
				continue;
			}

			$would_skip_marketing = $is_marketing && ! $this->can_receive_email( $participant, EmailType::MARKETING );

			$recipients[] = array(
				'participant_id'       => $participant->id,
				'name'                 => $participant->name,
				'surname'              => $participant->surname,
				'email'                => $participant->email,
				'label'                => $ep->label,
				'has_valid_email'      => $this->has_valid_email( $participant ),
				'would_skip_marketing' => $would_skip_marketing,
			);
		}

		return $recipients;
	}

	/**
	 * Send fee payment reminder to a single participant.
	 *
	 * @param Participant $participant  Participant object.
	 * @param object      $fee         Fee object.
	 * @param object      $fee_payment Fee payment object.
	 * @return bool Success.
	 */
	public function send_fee_reminder( $participant, $fee, $fee_payment ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: fee name */
			__( 'Payment reminder: %s', 'fair-audience' ),
			$fee->name
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
								' . esc_html__( 'This is a friendly reminder about a pending payment:', 'fair-audience' ) . '
							</p>

							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Fee:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( $fee->name ) . '</td>
								</tr>
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Amount:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( number_format( (float) $fee_payment->amount, 2 ) . ' ' . $fee->currency ) . '</td>
								</tr>';

		if ( ! empty( $fee->due_date ) ) {
			$message .= '
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Due Date:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( $fee->due_date ) . '</td>
								</tr>';
		}

		$message .= '
							</table>';

		// Add "Pay Now" button if fair-payment plugin is active.
		if ( function_exists( 'fair_payment_create_transaction' ) ) {
			$payment_url = FeePaymentToken::get_url( $fee_payment->id );
			$message    .= '
							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $payment_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Pay Now', 'fair-audience' ) . '
								</a>
							</p>';
		}

		$message .= '
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
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">';

		if ( function_exists( 'fair_payment_create_transaction' ) ) {
			$message .= '
							<p style="margin: 0 0 5px 0;">
								' . esc_html__( 'If the button above doesn\'t work, copy and paste this link:', 'fair-audience' ) . '
							</p>
							<p style="margin: 0 0 15px 0; word-break: break-all;">
								<a href="' . esc_url( $payment_url ) . '" style="color: #0073aa;">' . esc_url( $payment_url ) . '</a>
							</p>';
		}

		$message .= '
							<p style="margin: 0;">
								' . esc_html( $site_name ) . '
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
	 * Send bulk fee payment reminders.
	 *
	 * @param int $fee_id Fee ID.
	 * @return array Results array with 'sent' and 'failed' keys.
	 */
	public function send_bulk_fee_reminders( $fee_id ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'   => array(),
			'failed' => array(),
		);

		$fee_repository       = new FeeRepository();
		$payment_repository   = new FeePaymentRepository();
		$audit_log_repository = new FeeAuditLogRepository();

		$fee = $fee_repository->get_by_id( $fee_id );
		if ( ! $fee ) {
			$results['failed'][] = array(
				'email'  => '',
				'reason' => __( 'Fee not found.', 'fair-audience' ),
			);
			return $results;
		}

		$pending_payments = $payment_repository->get_pending_by_fee( $fee_id );

		foreach ( $pending_payments as $payment ) {
			$participant = $this->participant_repository->get_by_id( $payment->participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
				);
				continue;
			}

			$success = $this->send_fee_reminder( $participant, $fee, $payment );

			if ( $success ) {
				$results['sent'][] = $participant->email;

				// Update reminder_sent_at.
				$payment->reminder_sent_at = current_time( 'mysql' );
				$payment->save();

				// Log the action.
				$audit_log_repository->log_action(
					$payment->id,
					'reminder_sent',
					null,
					null,
					null
				);
			} else {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}

	/**
	 * Send form submission notification to admin/configured email.
	 *
	 * @param string $to_email          Recipient email address.
	 * @param string $submitter_name    Submitter's first name.
	 * @param string $submitter_surname Submitter's surname.
	 * @param string $submitter_email   Submitter's email.
	 * @param array  $answers           Questionnaire answers.
	 * @param int    $post_id           Post ID where the form was submitted.
	 * @return bool Success.
	 */
	public function send_form_notification( $to_email, $submitter_name, $submitter_surname, $submitter_email, $answers, $post_id = 0 ) {
		if ( empty( $to_email ) || ! is_email( $to_email ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$page_title = '';
		if ( $post_id > 0 ) {
			$post = get_post( $post_id );
			if ( $post ) {
				$page_title = $post->post_title;
			}
		}

		$subject = sprintf(
			/* translators: %s: site name */
			__( 'New form submission — %s', 'fair-audience' ),
			$site_name
		);

		// Build submitter info rows.
		$submitter_html = '<tr>
			<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html__( 'Name', 'fair-audience' ) . '</td>
			<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( trim( $submitter_name . ' ' . $submitter_surname ) ) . '</td>
		</tr>
		<tr>
			<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html__( 'Email', 'fair-audience' ) . '</td>
			<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;"><a href="mailto:' . esc_attr( $submitter_email ) . '" style="color: #0073aa;">' . esc_html( $submitter_email ) . '</a></td>
		</tr>';

		// Build answers table rows.
		$answers_html = '';
		foreach ( $answers as $answer ) {
			if ( 'file_upload' === ( $answer['question_type'] ?? '' ) ) {
				continue;
			}

			$question_text = esc_html( $answer['question_text'] ?? '' );
			$answer_value  = $answer['answer_value'] ?? '';

			$decoded = json_decode( $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$answers_html .= '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . $question_text . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( $answer_value ) . '</td>
			</tr>';
		}

		$context_html = '';
		if ( ! empty( $page_title ) ) {
			$context_html = '<p style="margin: 0 0 20px 0; font-size: 16px;">'
				. sprintf(
					/* translators: %s: page title */
					esc_html__( 'Page: %s', 'fair-audience' ),
					'<strong>' . esc_html( $page_title ) . '</strong>'
				)
				. '</p>';
		}

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
								' . esc_html__( 'A new form submission has been received.', 'fair-audience' ) . '
							</p>

							' . $context_html . '

							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $submitter_html . $answers_html . '
							</table>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0;">
								' . esc_html( $site_name ) . '
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		$result = wp_mail( $to_email, $subject, $message );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send form submission confirmation email to the submitter.
	 *
	 * @param Participant $participant Participant who submitted the form.
	 * @param array       $answers     Questionnaire answers.
	 * @param int         $post_id     Post ID where the form was submitted.
	 * @return bool Success.
	 */
	public function send_form_confirmation( Participant $participant, array $answers, int $post_id = 0 ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$page_title = '';
		if ( $post_id > 0 ) {
			$post = get_post( $post_id );
			if ( $post ) {
				$page_title = $post->post_title;
			}
		}

		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Your submission — %s', 'fair-audience' ),
			$site_name
		);

		// Build answers table rows.
		$answers_html = '';
		foreach ( $answers as $answer ) {
			if ( 'file_upload' === ( $answer['question_type'] ?? '' ) ) {
				continue;
			}

			$question_text = esc_html( $answer['question_text'] ?? '' );
			$answer_value  = $answer['answer_value'] ?? '';

			$decoded = json_decode( $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$answers_html .= '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . $question_text . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( $answer_value ) . '</td>
			</tr>';
		}

		$context_html = '';
		if ( ! empty( $page_title ) ) {
			$context_html = '<p style="margin: 0 0 20px 0; font-size: 16px;">'
				. sprintf(
					/* translators: %s: page title */
					esc_html__( 'Form: %s', 'fair-audience' ),
					'<strong>' . esc_html( $page_title ) . '</strong>'
				)
				. '</p>';
		}

		$answers_table = '';
		if ( ! empty( $answers_html ) ) {
			$answers_table = '
							<p style="margin: 0 0 10px 0; font-size: 16px;">
								' . esc_html__( 'Here are the answers you submitted:', 'fair-audience' ) . '
							</p>

							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $answers_html . '
							</table>';
		}

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
								' . esc_html__( 'Thank you for your submission! We have received your response.', 'fair-audience' ) . '
							</p>

							' . $context_html . '

							' . $answers_table . '

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
							<p style="margin: 0;">
								' . esc_html( $site_name ) . '
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		add_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		$result = wp_mail( $participant->email, $subject, $message );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Preview recipients for bulk custom mail to all audience.
	 *
	 * @param bool $is_marketing Whether to filter by marketing consent.
	 * @return array List of recipient info arrays.
	 */
	public function preview_custom_mail_recipients_all( $is_marketing = true, $group_ids = array() ) {
		$recipients   = array();
		$participants = $this->participant_repository->get_all();

		$group_participant_ids = $this->get_participant_ids_for_groups( $group_ids );

		foreach ( $participants as $participant ) {
			if ( ! empty( $group_ids ) && ! in_array( $participant->id, $group_participant_ids, true ) ) {
				continue;
			}

			$would_skip_marketing = $is_marketing && ! $this->can_receive_email( $participant, EmailType::MARKETING );

			$recipients[] = array(
				'participant_id'       => $participant->id,
				'name'                 => $participant->name,
				'surname'              => $participant->surname,
				'email'                => $participant->email,
				'label'                => '',
				'has_valid_email'      => $this->has_valid_email( $participant ),
				'would_skip_marketing' => $would_skip_marketing,
			);
		}

		return $recipients;
	}

	/**
	 * Send bulk event invitations to participants.
	 *
	 * Sends event signup link emails to the specified participants or group members.
	 * Participants who are already signed up for the event are skipped.
	 *
	 * @param int    $event_id        Event ID.
	 * @param string $custom_message  Optional custom message (unused, for future use).
	 * @param array  $participant_ids Optional array of participant IDs to send to.
	 * @param array  $group_ids       Optional array of group IDs to expand to participants.
	 * @param bool   $skip_signed_up  Whether to skip participants already signed up.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	/**
	 * Send event invitation to a single participant.
	 *
	 * Unlike send_signup_link_email (which is for requested links),
	 * this is a marketing email for participants who subscribed to updates.
	 *
	 * @param object $event           Event post object.
	 * @param object $participant     Participant object.
	 * @param string $signup_url      Full signup URL with participant token.
	 * @param string $custom_message  Optional custom message.
	 * @return bool Success.
	 */
	public function send_event_invitation( $event, $participant, $signup_url, $custom_message = '' ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build manage subscription URL for unsubscribe link.
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: event title */
			__( "You're invited: %s", 'fair-audience' ),
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
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $event->post_title ) . '</h1>
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
								esc_html__( 'We have a new event coming up: %s.', 'fair-audience' ),
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
								' . esc_html__( 'Would you like to join? Click the button below to sign up:', 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $signup_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Sign Up Now', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
										esc_html__( 'See you there!%1$sThe %2$s Team', 'fair-audience' ),
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
							<p style="margin: 0 0 15px 0; word-break: break-all;">
								<a href="' . esc_url( $signup_url ) . '" style="color: #0073aa;">' . esc_url( $signup_url ) . '</a>
							</p>
							<p style="margin: 0; border-top: 1px solid #e0e0e0; padding-top: 15px;">
								' . esc_html__( "Don't want to receive event invitations?", 'fair-audience' ) . '
								<a href="' . esc_url( $manage_subscription_url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your preferences', 'fair-audience' ) . '</a>
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
	 * Send event invitations in bulk.
	 *
	 * @param int    $event_id Event ID.
	 * @param string $custom_message Optional custom message.
	 * @param array  $participant_ids Participant IDs to send to.
	 * @param array  $group_ids Group IDs to expand.
	 * @param bool   $skip_signed_up Whether to skip already signed up participants.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_event_invitations(
		$event_id,
		$custom_message = '',
		$participant_ids = array(),
		$group_ids = array(),
		$skip_signed_up = true
	) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'    => array(),
			'failed'  => array(),
			'skipped' => array(),
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

		// Collect all participant IDs.
		$all_participant_ids = $participant_ids;

		// Expand group IDs to participant IDs.
		foreach ( $group_ids as $group_id ) {
			$members = $this->group_participant_repository->get_by_group( $group_id );
			foreach ( $members as $member ) {
				$all_participant_ids[] = $member->participant_id;
			}
		}

		// Deduplicate participant IDs.
		$all_participant_ids = array_unique( array_map( 'intval', $all_participant_ids ) );

		if ( empty( $all_participant_ids ) ) {
			return $results;
		}

		// Resolve event_date_id once for this event.
		$event_date_id = 0;
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = $event_dates_obj->id;
			}
		}

		// Get already signed up participants if we need to skip them.
		$signed_up_ids = array();
		if ( $skip_signed_up ) {
			$event_participants = $this->event_participant_repository->get_by_event( $event_id );
			foreach ( $event_participants as $ep ) {
				if ( 'signed_up' === $ep->label ) {
					$signed_up_ids[] = $ep->participant_id;
				}
			}
		}

		foreach ( $all_participant_ids as $participant_id ) {
			// Skip if already signed up.
			if ( $skip_signed_up && in_array( $participant_id, $signed_up_ids, true ) ) {
				$participant          = $this->participant_repository->get_by_id( $participant_id );
				$results['skipped'][] = array(
					'name'   => $participant ? $participant->name : '',
					'email'  => $participant ? $participant->email : '',
					'reason' => __( 'Already signed up', 'fair-audience' ),
				);
				continue;
			}

			// Get participant.
			$participant = $this->participant_repository->get_by_id( $participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no email address.', 'fair-audience' ),
				);
				continue;
			}

			// Check if participant can receive marketing emails.
			if ( ! $this->can_receive_email( $participant, EmailType::MARKETING ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'Participant opted out of marketing emails.', 'fair-audience' ),
				);
				continue;
			}

			// Generate participant token URL.
			$token_url = ParticipantToken::get_url( $participant_id, $event_date_id, $event->ID );

			// Send invitation email.
			$success = $this->send_event_invitation( $event, $participant, $token_url, $custom_message );

			if ( $success ) {
				$results['sent'][] = $participant->email;
			} else {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'wp_mail() failed to send.', 'fair-audience' ),
				);
			}
		}

		return $results;
	}
}
