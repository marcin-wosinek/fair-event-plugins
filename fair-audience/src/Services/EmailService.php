<?php
/**
 * Email Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudienceExperimental\Database\PollRepository;
use FairAudienceExperimental\Database\PollAccessKeyRepository;
use FairAudienceExperimental\Database\GalleryAccessKeyRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudienceExperimental\Database\GroupParticipantRepository;
use FairAudienceExperimental\Database\ExtraMessageRepository;
use FairAudienceExperimental\Database\FeeRepository;
use FairAudienceExperimental\Database\FeePaymentRepository;
use FairAudienceExperimental\Database\FeeAuditLogRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailType;
use FairAudience\Services\AudienceSignupToken;
use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Services\ParticipantToken;
use FairAudienceExperimental\Services\FeePaymentToken;
use FairAudience\Services\RecipientResolver;

defined( 'WPINC' ) || die;

/**
 * Service for sending poll invitation emails.
 */
class EmailService {

	/**
	 * Poll repository instance.
	 *
	 * @var PollRepository|null Null when fair-audience-experimental's `polls` bundle is inactive.
	 */
	private $poll_repository;

	/**
	 * Poll access key repository instance.
	 *
	 * @var PollAccessKeyRepository|null Null when fair-audience-experimental's `polls` bundle is inactive.
	 */
	private $access_key_repository;

	/**
	 * Gallery access key repository instance.
	 *
	 * @var GalleryAccessKeyRepository|null Null when fair-audience-experimental's `galleries` bundle is inactive.
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
	 * @var GroupParticipantRepository|null Null when fair-audience-experimental's `groups` bundle is inactive.
	 */
	private $group_participant_repository;

	/**
	 * Cached active extra messages per event (lazy-loaded).
	 *
	 * @var array
	 */
	private $active_extra_messages_cache = array();

	/**
	 * Recipient resolver instance.
	 *
	 * @var RecipientResolver
	 */
	private $recipient_resolver;

	/**
	 * Constructor.
	 */
	public function __construct() {
		// Polls live in fair-audience-experimental; only instantiate their
		// repositories when the companion (and its `polls` bundle) is active.
		if ( class_exists( PollRepository::class ) ) {
			$this->poll_repository       = new PollRepository();
			$this->access_key_repository = new PollAccessKeyRepository();
		}
		// Galleries live in fair-audience-experimental; only instantiate their
		// repository when the companion (and its `galleries` bundle) is active.
		$this->gallery_access_key_repository = class_exists( GalleryAccessKeyRepository::class )
			? new GalleryAccessKeyRepository()
			: null;
		$this->event_participant_repository  = new EventParticipantRepository();
		$this->participant_repository        = new ParticipantRepository();
		// Groups live in fair-audience-experimental; only instantiate their
		// repository when the companion (and its `groups` bundle) is active.
		$this->group_participant_repository = class_exists( GroupParticipantRepository::class )
			? new GroupParticipantRepository()
			: null;
		$this->recipient_resolver           = new RecipientResolver();
	}

	/**
	 * Get active extra messages for an event (lazy-loaded, cached per event).
	 *
	 * @param int $event_id Event post ID.
	 * @return \FairAudienceExperimental\Models\ExtraMessage[] Array of active extra messages, empty when
	 *         fair-audience-experimental's `messaging` bundle is inactive.
	 */
	private function get_active_extra_messages( $event_id ) {
		if ( ! isset( $this->active_extra_messages_cache[ $event_id ] ) ) {
			$this->active_extra_messages_cache[ $event_id ] = class_exists( ExtraMessageRepository::class )
				? ( new ExtraMessageRepository() )->get_active_for_event( $event_id )
				: array();
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
		return $this->recipient_resolver->can_receive_email( $participant, $email_type );
	}

	/**
	 * Human-readable reason a participant was skipped for a marketing send.
	 *
	 * @param Participant $participant The skipped participant.
	 * @param string      $email_type  The email type being sent (EmailType::MARKETING or EmailType::WEEKLY_SUMMARY).
	 * @return string Skip reason.
	 */
	private function marketing_skip_reason( Participant $participant, string $email_type = EmailType::MARKETING ): string {
		if ( 'marketing' === $participant->email_profile && 'pending' === $participant->status ) {
			return __( 'Participant has not yet confirmed their marketing subscription.', 'fair-audience' );
		}

		if ( EmailType::WEEKLY_SUMMARY === $email_type
			&& 'marketing' === $participant->email_profile
			&& 'confirmed' === $participant->status
			&& $participant->weekly_summary_opt_out
		) {
			return __( 'Opted out of the weekly summary.', 'fair-audience' );
		}

		return __( 'Participant opted out of marketing emails.', 'fair-audience' );
	}

	/**
	 * Check if a participant has a valid email address.
	 *
	 * @param Participant $participant The participant to check.
	 * @return bool True if the participant has a non-empty email.
	 */
	private function has_valid_email( Participant $participant ): bool {
		return $this->recipient_resolver->has_valid_email( $participant );
	}

	/**
	 * Get unique participant IDs for an array of group IDs.
	 *
	 * @param array $group_ids Array of group IDs.
	 * @return array Array of unique participant IDs.
	 */
	private function get_participant_ids_for_groups( $group_ids ) {
		return $this->recipient_resolver->get_participant_ids_for_groups( $group_ids );
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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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

		$answers_html = $this->render_answer_rows( $answers );

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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
	 * Send an email inviting a returning visitor to resume a registration that
	 * was stashed because their browser held no session for the matching
	 * participant. Unlike send_signup_link_email(), this tells them their
	 * answers are already saved — clicking through continues the in-progress
	 * registration instead of landing on a blank form.
	 *
	 * @param object      $event      Event post object.
	 * @param Participant $participant Participant object.
	 * @param string      $resume_url Full resume URL (participant token + resume token).
	 * @param bool        $is_paid    Whether the resumed registration still needs payment.
	 * @return bool Success.
	 */
	public function send_resume_registration_email( $event, $participant, $resume_url, $is_paid ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build manage subscription URL for unsubscribe link.
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

		// Subject line.
		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Continue registering for %s', 'fair-audience' ),
			$event->post_title
		);

		$button_text = $is_paid
			? __( 'Continue to payment', 'fair-audience' )
			: __( 'Continue to sign up', 'fair-audience' );

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
								esc_html__( "You're registering for %s.", 'fair-audience' ),
								'<strong>' . esc_html( $event->post_title ) . '</strong>'
							) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( "We've saved your answers — click below to continue where you left off:", 'fair-audience' ) . '
							</p>

							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . esc_url( $resume_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . esc_html( $button_text ) . '
								</a>
							</p>

							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">
								' . esc_html__( "If you didn't try to register, you can safely ignore this email.", 'fair-audience' ) . '
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: 1: line break, 2: site name */
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
								<a href="' . esc_url( $resume_url ) . '" style="color: #0073aa;">' . esc_url( $resume_url ) . '</a>
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
	 * @param array       $context       Per-message context: event_name, event_date.
	 * @return string Processed content.
	 */
	private function replace_placeholders( $content, $participant, $event_date_id = 0, $context = array() ) {
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

		if ( false !== strpos( $content, '{event_page_url}' ) ) {
			$post_id = 0;
			if ( $event_date_id > 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
				if ( $event_date && ! empty( $event_date->event_id ) ) {
					$post_id = (int) $event_date->event_id;
				}
			}
			$url     = ParticipantToken::get_url( $participant->id, $event_date_id, $post_id );
			$content = str_replace( '{event_page_url}', esc_url( $url ), $content );
		}

		if ( false !== strpos( $content, '{unsubscribe_link}' ) ) {
			$url     = ManageSubscriptionToken::get_url( $participant->id );
			$content = str_replace( '{unsubscribe_link}', esc_url( $url ), $content );
		}

		if ( false !== strpos( $content, '{participant_name}' ) ) {
			$content = str_replace( '{participant_name}', esc_html( $participant->name ), $content );
		}

		if ( false !== strpos( $content, '{event_name}' ) ) {
			$event_name = isset( $context['event_name'] ) ? $context['event_name'] : '';
			$content    = str_replace( '{event_name}', esc_html( $event_name ), $content );
		}

		if ( false !== strpos( $content, '{event_date}' ) ) {
			$event_date = isset( $context['event_date'] ) ? $context['event_date'] : '';
			$content    = str_replace( '{event_date}', esc_html( $event_date ), $content );
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
	 * Build the branded HTML email body wrapping custom-mail content.
	 *
	 * Shared by the ad-hoc custom-mail flow and scheduled event mailings.
	 *
	 * @param Participant $participant Participant the email greets.
	 * @param string      $content     Inner HTML content (placeholders resolved).
	 * @return string Full HTML document.
	 */
	private function build_custom_mail_html( $participant, $content ) {
		$site_name               = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$manage_subscription_url = ManageSubscriptionToken::get_url( $participant->id );

		return '<!DOCTYPE html>
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
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>
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
									/* translators: 1: line break, 2: site name */
									esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
									'<br>',
									esc_html( $site_name )
								) . '
							</p>
						</td>
					</tr>
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
	}

	/**
	 * Dispatch an HTML email, toggling the content-type filter around the send.
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Email subject.
	 * @param string $message Full HTML body.
	 * @return bool Whether wp_mail() accepted the message.
	 */
	private function dispatch_html_mail( $to, $subject, $message ) {
		$content_type = static function () {
			return 'text/html';
		};

		add_filter( 'wp_mail_content_type', $content_type );
		$result = wp_mail( $to, $subject, $this->append_branding_footer( $message ) );
		remove_filter( 'wp_mail_content_type', $content_type );

		return $result;
	}

	/**
	 * Append the opt-in "Powered by Fair Event Plugins" footer to an HTML body.
	 *
	 * Inserts the inline-styled line just before </body> so it sits at the very
	 * bottom of every participant email. A no-op (returns the message unchanged)
	 * when the branding setting is off, so disabling it removes the markup
	 * entirely rather than merely hiding it.
	 *
	 * @param string $message Full HTML email body.
	 * @return string Message with the footer injected, or unchanged when off.
	 */
	private function append_branding_footer( $message ) {
		$footer = \FairAudience\Services\Branding::email_footer_html();
		if ( '' === $footer ) {
			return $message;
		}

		if ( false === strpos( $message, '</body>' ) ) {
			return $message . $footer;
		}

		return str_replace( '</body>', $footer . '</body>', $message );
	}

	/**
	 * Render and send a scheduled-message body to one participant.
	 *
	 * Resolves placeholders (including {event_name}/{event_date} from the
	 * per-message context), wraps the content in the shared template, and
	 * dispatches the email. Caller is responsible for recipient eligibility
	 * (valid email, marketing consent).
	 *
	 * @param Participant $participant   Recipient.
	 * @param string      $subject       Email subject.
	 * @param string      $content       Body HTML with placeholders.
	 * @param int         $event_date_id Event date ID for tokenized links.
	 * @param array       $context       Per-message context: event_name, event_date.
	 * @return bool Success.
	 */
	public function send_custom_mail_rendered( $participant, $subject, $content, $event_date_id = 0, $context = array() ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$content = $this->replace_placeholders( $content, $participant, $event_date_id, $context );
		$message = $this->build_custom_mail_html( $participant, $content );

		return $this->dispatch_html_mail( $participant->email, $subject, $message );
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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
					'reason' => $this->marketing_skip_reason( $participant ),
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
	 * @param array  $group_ids    Group IDs to filter by.
	 * @param string $email_type   EmailType constant used for the consent check (defaults to MARKETING).
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_custom_mail_to_all( $subject, $content, $is_marketing = true, $skip_participant_ids = array(), $group_ids = array(), $email_type = EmailType::MARKETING ) {
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
			if ( $is_marketing && ! $this->can_receive_email( $participant, $email_type ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => $this->marketing_skip_reason( $participant, $email_type ),
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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
		return $this->recipient_resolver->resolve(
			array(
				'labels'       => $labels,
				'group_ids'    => $group_ids,
				'is_marketing' => $is_marketing,
			),
			$event_id
		);
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

		// Add "Pay Now" button if fair-payments-connector plugin is active.
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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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

		$answers_html = $this->render_answer_rows( $answers );

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

		$result = wp_mail( $to_email, $subject, $this->append_branding_footer( $message ) );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send pre-rendered HTML content to a raw email address.
	 *
	 * Unlike `send_custom_mail*()`, this has no Participant to resolve
	 * placeholders or an unsubscribe link for — used for admin-facing sends
	 * (e.g. the weekly digest "send test to me").
	 *
	 * @param string $to_email Recipient email address.
	 * @param string $subject  Email subject.
	 * @param string $content  Email content (HTML).
	 * @return bool Whether wp_mail() accepted the message.
	 */
	public function send_html_mail_to_address( $to_email, $subject, $content ) {
		if ( empty( $to_email ) || ! is_email( $to_email ) ) {
			return false;
		}

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

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
							<div style="margin: 0; font-size: 16px;">
								' . wp_kses_post( $content ) . '
							</div>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0;">
								' . esc_html( $site_name ) . '
							</p>
							<p style="margin: 10px 0 0 0; font-style: italic;">
								' . esc_html__( '[Test email — real sends to subscribers include a "Manage your preferences" unsubscribe link here.]', 'fair-audience' ) . '
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

		$result = wp_mail( $to_email, $subject, $this->append_branding_footer( $message ) );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Render questionnaire answers as `<tr>` rows for the email tables.
	 *
	 * Shared by signup-answers, form-confirmation, form-notification and signup
	 * confirmation emails so the formatting stays in one place.
	 *
	 * Accepts both array-shaped answers (as produced by the REST request) and
	 * QuestionnaireAnswer model objects (as returned by the repository).
	 * `multiselect` values arrive JSON-encoded — those are decoded to a
	 * comma-joined list. `file_upload` values are the attachment ID; resolve
	 * to a clickable link when possible, otherwise render the raw value.
	 *
	 * @param array $answers Array of answer arrays or QuestionnaireAnswer objects.
	 * @return string `<tr>...</tr>` markup, or '' when nothing renderable.
	 */
	private function render_answer_rows( array $answers ): string {
		$rows = '';
		foreach ( $answers as $answer ) {
			$question_text = is_object( $answer ) ? ( $answer->question_text ?? '' ) : ( $answer['question_text'] ?? '' );
			$question_type = is_object( $answer ) ? ( $answer->question_type ?? '' ) : ( $answer['question_type'] ?? '' );
			$answer_value  = is_object( $answer ) ? ( $answer->answer_value ?? '' ) : ( $answer['answer_value'] ?? '' );

			if ( 'file_upload' === $question_type ) {
				$value_html = '';
				if ( is_numeric( $answer_value ) ) {
					$attachment_id  = (int) $answer_value;
					$attachment_url = wp_get_attachment_url( $attachment_id );
					if ( $attachment_url ) {
						$label      = get_the_title( $attachment_id );
						$value_html = '<a href="' . esc_url( $attachment_url ) . '" style="color: #0073aa;">'
							. esc_html( $label ? $label : basename( $attachment_url ) )
							. '</a>';
					}
				}
				if ( '' === $value_html ) {
					// No resolvable attachment — skip rather than show a stray ID.
					continue;
				}

				$rows .= '<tr>
					<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html( $question_text ) . '</td>
					<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . $value_html . '</td>
				</tr>';
				continue;
			}

			$decoded = json_decode( (string) $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$rows .= '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html( $question_text ) . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( $answer_value ) . '</td>
			</tr>';
		}

		return $rows;
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

		$answers_html = $this->render_answer_rows( $answers );

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
									/* translators: 1: line break, 2: site name */
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

		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send signup confirmation email to the participant.
	 *
	 * @param Participant   $participant   Participant who signed up.
	 * @param \WP_Post|null $event         Event post object (nullable).
	 * @param object|null   $transaction   Transaction row from fair-payments-connector (null for free signups).
	 * @param array         $option_names  Names of the selected ticket-activity options.
	 * @param int           $event_date_id Event date ID — used to load the signup
	 *                                     questionnaire answers so they can be
	 *                                     included in the email. Pass 0 to skip.
	 * @return bool Success.
	 */
	public function send_signup_payment_confirmation( Participant $participant, $event, $transaction = null, $option_names = array(), int $event_date_id = 0 ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event ? $event->post_title : __( 'Event', 'fair-audience' );

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Signup confirmed — %s', 'fair-audience' ),
			$event_title
		);

		$amount   = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';

		$payment_html = '';
		if ( $amount > 0 ) {
			$payment_html = '
							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Amount paid:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( number_format( $amount, 2 ) . ' ' . $currency ) . '</td>
								</tr>
							</table>';
		}

		$options_html = '';
		if ( ! empty( $option_names ) ) {
			$options_list = '';
			foreach ( $option_names as $name ) {
				$options_list .= '<li style="padding: 4px 0;">' . esc_html( $name ) . '</li>';
			}
			$options_html = '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . esc_html__( 'Selected options:', 'fair-audience' ) . '</p>
							<ul style="margin: 0 0 20px 20px; padding: 0;">' . $options_list . '</ul>';
		}

		// Custom signup question answers (Event Signup questionnaire submission).
		$answers_html = '';
		if ( $event_date_id > 0 && class_exists( '\FairForm\Database\QuestionnaireSubmissionRepository' ) ) {
			$submission_repo = new \FairForm\Database\QuestionnaireSubmissionRepository();
			$submissions     = $submission_repo->get_by_filters(
				array(
					'participant_id' => (int) $participant->id,
					'event_date_id'  => $event_date_id,
					'title'          => __( 'Event Signup', 'fair-audience' ),
				)
			);

			if ( ! empty( $submissions ) ) {
				$answer_repo = new \FairForm\Database\QuestionnaireAnswerRepository();
				$rows_html   = $this->render_answer_rows( $answer_repo->get_by_submission( $submissions[0]->id ) );
				if ( '' !== $rows_html ) {
					$answers_html = '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . esc_html__( 'Your answers:', 'fair-audience' ) . '</p>
							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">'
						. $rows_html
						. '</table>';
				}
			}
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
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $event_title ) . '</h1>
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
								$transaction
									/* translators: %s: event title */
									? esc_html__( 'Your signup for %s has been confirmed and your payment has been received.', 'fair-audience' )
									/* translators: %s: event title */
									: esc_html__( 'Your signup for %s has been confirmed.', 'fair-audience' ),
								'<strong>' . esc_html( $event_title ) . '</strong>'
							) . '
							</p>

							' . $payment_html . '

							' . $options_html . '

							' . $answers_html . '

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: 1: line break, 2: site name */
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

		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send a confirmation email after activities are added to an existing
	 * subscription. Lists the newly added activities and (for paid adds) the
	 * amount paid for them.
	 *
	 * @param Participant   $participant       Participant who added activities.
	 * @param \WP_Post|null $event             Event post object (nullable).
	 * @param object|null   $transaction       Transaction row (null for free adds).
	 * @param array         $added_option_names Names of the activities that were added.
	 * @return bool Success.
	 */
	public function send_activities_added_confirmation( Participant $participant, $event, $transaction = null, $added_option_names = array() ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event ? $event->post_title : __( 'Event', 'fair-audience' );

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Activities added — %s', 'fair-audience' ),
			$event_title
		);

		$amount   = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';

		$payment_html = '';
		if ( $amount > 0 ) {
			$payment_html = '
							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Amount paid:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( number_format( $amount, 2 ) . ' ' . $currency ) . '</td>
								</tr>
							</table>';
		}

		$options_html = '';
		if ( ! empty( $added_option_names ) ) {
			$options_list = '';
			foreach ( $added_option_names as $name ) {
				$options_list .= '<li style="padding: 4px 0;">' . esc_html( $name ) . '</li>';
			}
			$options_html = '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . esc_html__( 'Activities added:', 'fair-audience' ) . '</p>
							<ul style="margin: 0 0 20px 20px; padding: 0;">' . $options_list . '</ul>';
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
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $event_title ) . '</h1>
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
								esc_html__( 'The following activities have been added to your signup for %s.', 'fair-audience' ),
								'<strong>' . esc_html( $event_title ) . '</strong>'
							) . '
							</p>

							' . $options_html . '

							' . $payment_html . '

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: 1: line break, 2: site name */
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

		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

		remove_filter(
			'wp_mail_content_type',
			function () {
				return 'text/html';
			}
		);

		return $result;
	}

	/**
	 * Send payment-failure email with a resume link.
	 *
	 * Fires for Mollie failed/cancelled/expired transitions on signup
	 * transactions. The resume link carries a participant_token so the user
	 * can re-issue the session and land on the retry UI from any device.
	 *
	 * @param Participant $participant   Buyer.
	 * @param \WP_Post    $event         Event post.
	 * @param int         $event_date_id Event date row ID (occurrence).
	 * @param object|null $transaction   Transaction row from fair-payments-connector.
	 * @return bool Success.
	 */
	public function send_signup_payment_failed( Participant $participant, $event, int $event_date_id, $transaction = null ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event ? $event->post_title : __( 'Event', 'fair-audience' );
		$event_id    = $event ? (int) $event->ID : 0;

		$resume_url = ParticipantToken::get_url( (int) $participant->id, $event_date_id, $event_id );

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Payment didn’t go through — %s', 'fair-audience' ),
			$event_title
		);

		$amount   = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';

		$amount_html = '';
		if ( $amount > 0 ) {
			$amount_html = '
							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . esc_html__( 'Amount:', 'fair-audience' ) . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . esc_html( number_format( $amount, 2 ) . ' ' . $currency ) . '</td>
								</tr>
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
					<tr>
						<td style="background-color: #b32d2e; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $event_title ) . '</h1>
						</td>
					</tr>

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
								esc_html__( 'Your payment for %s didn’t go through. Your spot is still held for a short while — pick up where you left off using the link below.', 'fair-audience' ),
								'<strong>' . esc_html( $event_title ) . '</strong>'
							) . '
							</p>

							' . $amount_html . '

							<p style="margin: 30px 0; text-align: center;">
								<a href="' . esc_url( $resume_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 4px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Resume payment', 'fair-audience' ) . '
								</a>
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . esc_html__( 'If the button doesn’t work, copy and paste this link into your browser:', 'fair-audience' ) . '<br>
								<a href="' . esc_url( $resume_url ) . '" style="color: #0073aa; word-break: break-all;">' . esc_html( $resume_url ) . '</a>
							</p>

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf(
									/* translators: %s: site name */
									esc_html__( 'See you soon,%1$sThe %2$s Team', 'fair-audience' ),
									'<br>',
									esc_html( $site_name )
								) . '
							</p>
						</td>
					</tr>

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

		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
		return $this->recipient_resolver->resolve(
			array(
				'group_ids'    => $group_ids,
				'is_marketing' => $is_marketing,
			),
			null
		);
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
									/* translators: 1: line break, 2: site name */
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
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );

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
	 * @param int    $event_date_id Specific occurrence to scope to. When > 0,
	 *                              already-signed-up skips and the token URL
	 *                              both reference this occurrence rather than
	 *                              the event's master row. Required when
	 *                              inviting to one occurrence of a recurring
	 *                              series so signups for sibling dates don't
	 *                              suppress the invitation.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_event_invitations(
		$event_id,
		$custom_message = '',
		$participant_ids = array(),
		$group_ids = array(),
		$skip_signed_up = true,
		$event_date_id = 0
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
		if ( $this->group_participant_repository ) {
			foreach ( $group_ids as $group_id ) {
				$members = $this->group_participant_repository->get_by_group( $group_id );
				foreach ( $members as $member ) {
					$all_participant_ids[] = $member->participant_id;
				}
			}
		}

		// Deduplicate participant IDs.
		$all_participant_ids = array_unique( array_map( 'intval', $all_participant_ids ) );

		if ( empty( $all_participant_ids ) ) {
			return $results;
		}

		// Resolve event_date_id once for this event when the caller didn't
		// provide one. The fallback (event's master row) is fine for single
		// events, but recurring series should always be invited per
		// occurrence — the caller passes the picked event_date_id then.
		$event_date_id = (int) $event_date_id;
		if ( $event_date_id <= 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		// Get already-signed-up participants. When we have a specific
		// occurrence, scope the skip-list to that occurrence so a participant
		// signed up to a different date in the same series still receives
		// this invitation. Without an occurrence (single events / legacy
		// callers) fall back to the event-wide list.
		$signed_up_ids = array();
		if ( $skip_signed_up ) {
			if ( $event_date_id > 0 ) {
				$event_participants = $this->event_participant_repository->get_by_event_date( $event_date_id );
			} else {
				$event_participants = $this->event_participant_repository->get_by_event( $event_id );
			}
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
					'reason' => $this->marketing_skip_reason( $participant ),
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

	/**
	 * Send confirmation for an anonymous event-interest signup.
	 *
	 * Includes a tokenized unsubscribe link so the recipient can pull out
	 * without needing an account.
	 *
	 * @param Participant $participant   Participant who registered interest.
	 * @param int         $event_id      Event post ID.
	 * @param int         $event_date_id Event date ID (scopes the unsubscribe token).
	 * @return bool True if mail dispatched.
	 */
	public function send_event_interest_confirmation( Participant $participant, int $event_id, int $event_date_id ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = get_the_title( $event_id );
		if ( empty( $event_title ) ) {
			$event_title = $site_name;
		}

		// Token encodes (participant_id, event_date_id) so the unsubscribe is
		// scoped to this single event. The query var triggers a
		// template_redirect handler that runs the same logic as the DELETE
		// endpoint and renders a thank-you page.
		$token           = ParticipantToken::generate( (int) $participant->id, $event_date_id );
		$unsubscribe_url = add_query_arg(
			array(
				'unsubscribe_event_interest' => '1',
				'token'                      => $token,
			),
			home_url( '/' )
		);

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Thanks for your interest in %s', 'fair-audience' ),
			$event_title
		);

		$greeting_name = ! empty( $participant->name ) ? $participant->name : __( 'there', 'fair-audience' );

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
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $event_title ) . '</h1>
						</td>
					</tr>
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0;">' . sprintf(
								/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $greeting_name ) . '</strong>'
							) . '</p>
							<p style="margin: 0 0 20px 0;">' . sprintf(
								/* translators: %s: event title */
								esc_html__( 'Thanks for registering your interest in %s. We will let you know when there are updates.', 'fair-audience' ),
								'<strong>' . esc_html( $event_title ) . '</strong>'
							) . '</p>
							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">' . esc_html__( "If you didn't register your interest, you can safely ignore this email.", 'fair-audience' ) . '</p>
						</td>
					</tr>
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">' . esc_html__( 'No longer interested?', 'fair-audience' ) . '</p>
							<p style="margin: 0;"><a href="' . esc_url( $unsubscribe_url ) . '" style="color: #0073aa;">' . esc_html__( 'Unsubscribe from updates about this event', 'fair-audience' ) . '</a></p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		$content_type_filter = function () {
			return 'text/html';
		};
		add_filter( 'wp_mail_content_type', $content_type_filter );
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );
		remove_filter( 'wp_mail_content_type', $content_type_filter );

		return (bool) $result;
	}

	/**
	 * Send a "welcome to the mailing list" email.
	 *
	 * Sent when an organizer records a participant's marketing consent (e.g. a
	 * verbal/paper consent collected at an event). This is single opt-in: the
	 * participant has already consented, so the email confirms the subscription
	 * and provides a manage-subscription / unsubscribe link rather than asking
	 * them to confirm.
	 *
	 * @param Participant $participant Participant who was added to the list.
	 * @param int         $event_id    Event post ID where consent was given.
	 * @return bool True if mail dispatched.
	 */
	public function send_mailing_list_welcome( Participant $participant, int $event_id ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event_id ? get_the_title( $event_id ) : '';

		$manage_subscription_url = ManageSubscriptionToken::get_url( (int) $participant->id );

		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Welcome to the %s mailing list', 'fair-audience' ),
			$site_name
		);

		$greeting_name = ! empty( $participant->name ) ? $participant->name : __( 'there', 'fair-audience' );

		if ( ! empty( $event_title ) ) {
			$intro = sprintf(
				/* translators: 1: site name, 2: event title */
				esc_html__( 'You\'ve been added to the %1$s mailing list following the consent you gave at %2$s. We\'ll keep you posted about upcoming events and news.', 'fair-audience' ),
				'<strong>' . esc_html( $site_name ) . '</strong>',
				'<strong>' . esc_html( $event_title ) . '</strong>'
			);
		} else {
			$intro = sprintf(
				/* translators: %s: site name */
				esc_html__( 'You\'ve been added to the %s mailing list following the consent you gave. We\'ll keep you posted about upcoming events and news.', 'fair-audience' ),
				'<strong>' . esc_html( $site_name ) . '</strong>'
			);
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
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0;">' . sprintf(
								/* translators: %s: participant first name */
								esc_html__( 'Hi %s,', 'fair-audience' ),
								'<strong>' . esc_html( $greeting_name ) . '</strong>'
							) . '</p>
							<p style="margin: 0 0 20px 0;">' . $intro . '</p>
						</td>
					</tr>
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0 0 5px 0;">' . esc_html__( 'Changed your mind?', 'fair-audience' ) . '</p>
							<p style="margin: 0;"><a href="' . esc_url( $manage_subscription_url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your subscription or unsubscribe', 'fair-audience' ) . '</a></p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		$content_type_filter = function () {
			return 'text/html';
		};
		add_filter( 'wp_mail_content_type', $content_type_filter );
		$result = wp_mail( $participant->email, $subject, $this->append_branding_footer( $message ) );
		remove_filter( 'wp_mail_content_type', $content_type_filter );

		return (bool) $result;
	}

	/**
	 * Cron hook used to dispatch deferred emails.
	 */
	const DEFERRED_EMAIL_HOOK = 'fair_audience_send_deferred_email';

	/**
	 * Methods that may be invoked through the deferred-email cron hook.
	 *
	 * Acts as an allow-list so a tampered cron entry can't call arbitrary
	 * EmailService methods.
	 *
	 * @var string[]
	 */
	const DEFERRABLE_METHODS = array(
		'send_event_interest_confirmation',
		'send_audience_signup_answers_email',
		'send_confirmation_email',
		'send_form_confirmation',
		'send_form_notification',
	);

	/**
	 * Queue an email to be sent after the current request, off the critical path.
	 *
	 * Front-end signup endpoints persist their row first, then send a
	 * confirmation email. Sending it synchronously blocks the HTTP response on
	 * the mail transport: a slow or unreachable SMTP server makes the request
	 * hang until the socket times out, which surfaces in the browser as
	 * net::ERR_TIMED_OUT even though the signup was already saved. Scheduling a
	 * single cron event lets the REST response return immediately; the mail goes
	 * out on the next cron tick regardless of transport health.
	 *
	 * @param string $method EmailService method name to invoke (must be in DEFERRABLE_METHODS).
	 * @param array  $args   Positional arguments for that method.
	 * @return void
	 */
	public static function defer( string $method, array $args ): void {
		if ( ! in_array( $method, self::DEFERRABLE_METHODS, true ) ) {
			return;
		}

		wp_schedule_single_event( time(), self::DEFERRED_EMAIL_HOOK, array( $method, $args ) );
	}

	/**
	 * Cron callback: invoke a previously deferred EmailService method.
	 *
	 * @param string $method Method name.
	 * @param array  $args   Positional arguments.
	 * @return void
	 */
	public static function run_deferred( string $method, array $args ): void {
		if ( ! in_array( $method, self::DEFERRABLE_METHODS, true ) ) {
			return;
		}

		$service = new self();
		call_user_func_array( array( $service, $method ), $args );
	}
}
