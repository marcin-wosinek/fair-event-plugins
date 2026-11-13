<?php
/**
 * Email Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudienceExperimental\Database\PollRepository;
use FairAudienceExperimental\Database\PollAccessKeyRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\ParticipantFeedRepository;
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
use FairEventsShared\Money;
use FairEventsShared\Notifications\BookingConfirmationEmail;
use FairEventsShared\Notifications\FormSubmissionEmail;
use FairEventsShared\Notifications\QuestionnaireAnswerRows;
use FairEventsShared\Notifications\SignupConfirmationEmail;

defined( 'WPINC' ) || die;

/**
 * Service for sending poll invitation emails.
 */
class EmailService {

	/**
	 * Why an event invitation leaves someone out: already signed up to the date.
	 */
	const INVITATION_EXCLUDED_SIGNED_UP = 'already_signed_up';

	/**
	 * Why an event invitation leaves someone out: the participant no longer exists.
	 */
	const INVITATION_EXCLUDED_UNAVAILABLE = 'unavailable';

	/**
	 * Why an event invitation leaves someone out: no valid email address.
	 */
	const INVITATION_EXCLUDED_INVALID_EMAIL = 'invalid_email';

	/**
	 * Why an event invitation leaves someone out: no confirmed marketing consent.
	 */
	const INVITATION_EXCLUDED_NO_CONSENT = 'no_marketing_consent';

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
	 * Participant weekly-feed repository instance.
	 *
	 * @var ParticipantFeedRepository
	 */
	private $participant_feed_repository;

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
		$this->event_participant_repository = new EventParticipantRepository();
		$this->participant_repository       = new ParticipantRepository();
		$this->participant_feed_repository  = new ParticipantFeedRepository();
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
		if ( EmailType::WEEKLY_SUMMARY === $email_type ) {
			return 'confirmed' === $participant->status
				? __( 'Opted out of the weekly summary.', 'fair-audience' )
				: __( 'Participant has not yet confirmed their email address.', 'fair-audience' );
		}

		if ( 'marketing' === $participant->email_profile && 'pending' === $participant->status ) {
			return __( 'Participant has not yet confirmed their marketing subscription.', 'fair-audience' );
		}

		return __( 'Participant opted out of marketing emails.', 'fair-audience' );
	}

	/**
	 * Machine-readable counterpart of {@see marketing_skip_reason()}.
	 *
	 * @param Participant $participant The skipped participant.
	 * @param string      $email_type  EmailType constant used for the consent check.
	 * @return string
	 */
	private function marketing_skip_code( Participant $participant, string $email_type = EmailType::MARKETING ): string {
		if ( EmailType::WEEKLY_SUMMARY === $email_type ) {
			return 'confirmed' === $participant->status ? 'weekly_summary_opt_out' : 'consent_pending';
		}

		if ( 'marketing' === $participant->email_profile && 'pending' === $participant->status ) {
			return 'consent_pending';
		}

		return 'marketing_opt_out';
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

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: event title */
					esc_html__( "We'd love to hear from you about %s!", 'fair-audience' ),
					'<strong>' . esc_html( $event->post_title ) . '</strong>'
				)
			);

		if ( ! empty( $custom_message ) ) {
			$content .= EmailLayout::paragraph( nl2br( esc_html( $custom_message ) ) );
		}

		$content .= EmailLayout::paragraph( esc_html__( 'Please take a moment to answer our quick poll:', 'fair-audience' ) )
			. EmailLayout::button( esc_url( $poll_url ), esc_html__( 'Answer Poll', 'fair-audience' ) )
			. $this->thanks_html( $site_name, EmailLayout::NOTE );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $this->button_fallback_html( $poll_url ) );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
					'reason' => __( 'Participant has no valid email address.', 'fair-audience' ),
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

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph( esc_html__( 'Thank you for signing up for our mailing list! Please confirm your email address by clicking the button below.', 'fair-audience' ) )
			. EmailLayout::button( esc_url( $confirm_url ), esc_html__( 'Confirm Email', 'fair-audience' ) )
			. EmailLayout::paragraph( esc_html__( 'This link will expire in 48 hours.', 'fair-audience' ), EmailLayout::NOTE )
			. EmailLayout::paragraph( esc_html__( "If you didn't sign up for this mailing list, you can safely ignore this email.", 'fair-audience' ), EmailLayout::NOTE )
			. $this->thanks_html( $site_name );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $this->button_fallback_html( $confirm_url ) );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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

		$answers_html = QuestionnaireAnswerRows::html( $answers );

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph( esc_html__( 'Thank you for signing up! Here are the answers you submitted:', 'fair-audience' ) )
			. EmailLayout::answers_table( $answers_html, '0 0 30px 0' )
			. EmailLayout::button( esc_url( $edit_url ), esc_html__( 'Edit Your Answers', 'fair-audience' ) )
			. $this->thanks_html( $site_name );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $this->button_fallback_html( $edit_url ) );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
	}

	/**
	 * Send an email inviting a returning visitor to resume a registration that
	 * was stashed because their browser held no session for the matching
	 * participant. It tells them their answers are already saved — clicking
	 * through continues the in-progress registration instead of landing on a
	 * blank form.
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

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: event title */
					esc_html__( "You're registering for %s.", 'fair-audience' ),
					'<strong>' . esc_html( $event->post_title ) . '</strong>'
				)
			)
			. EmailLayout::paragraph( esc_html__( "We've saved your answers — click below to continue where you left off:", 'fair-audience' ) )
			. EmailLayout::button( esc_url( $resume_url ), esc_html( $button_text ) )
			. EmailLayout::paragraph( esc_html__( "If you didn't try to register, you can safely ignore this email.", 'fair-audience' ), EmailLayout::NOTE )
			. $this->thanks_html( $site_name );

		$footer = $this->button_fallback_html( $resume_url, true )
			. $this->invitation_preferences_html( $manage_subscription_url );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $footer );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
		$content = RetiredPlaceholders::strip( $content );

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

		$body = $this->greeting_html( $participant->name ) . '
							<div style="margin: 0 0 20px 0; font-size: 16px;">
								' . wp_kses_post( $content ) . '
							</div>'
			. $this->thanks_html( $site_name );

		$footer = $this->manage_preferences_html(
			esc_html__( "Don't want to receive these emails?", 'fair-audience' ),
			$manage_subscription_url,
			'margin: 0;'
		);

		return EmailLayout::document( esc_html( $site_name ), $body, $footer );
	}

	/**
	 * Render the standard "Hi <name>," greeting paragraph.
	 *
	 * @param string $name Unescaped recipient name.
	 * @return string Paragraph HTML.
	 */
	private function greeting_html( $name ) {
		return EmailLayout::paragraph(
			sprintf(
				/* translators: %s: participant first name */
				esc_html__( 'Hi %s,', 'fair-audience' ),
				'<strong>' . esc_html( $name ) . '</strong>'
			)
		);
	}

	/**
	 * Render the "Thanks, The <site> Team" sign-off.
	 *
	 * @param string $site_name Unescaped site name.
	 * @param string $style     Paragraph style.
	 * @return string Paragraph HTML.
	 */
	private function thanks_html( $site_name, $style = EmailLayout::SIGN_OFF ) {
		return EmailLayout::paragraph(
			sprintf(
				/* translators: 1: line break, 2: site name */
				esc_html__( 'Thanks,%1$sThe %2$s Team', 'fair-audience' ),
				'<br>',
				esc_html( $site_name )
			),
			$style
		);
	}

	/**
	 * Render the "See you there! The <site> Team" sign-off.
	 *
	 * @param string $site_name Unescaped site name.
	 * @return string Paragraph HTML.
	 */
	private function see_you_there_html( $site_name ) {
		return EmailLayout::paragraph(
			sprintf(
				/* translators: 1: line break, 2: site name */
				esc_html__( 'See you there!%1$sThe %2$s Team', 'fair-audience' ),
				'<br>',
				esc_html( $site_name )
			),
			EmailLayout::SIGN_OFF
		);
	}

	/**
	 * Render the copy-this-link fallback for a message's main button.
	 *
	 * @param string $url          Unescaped button destination.
	 * @param bool   $more_follows Whether more footer content follows.
	 * @return string Footer HTML.
	 */
	private function button_fallback_html( $url, $more_follows = false ) {
		return EmailLayout::link_fallback(
			esc_html__( "If the button above doesn't work, copy and paste this link:", 'fair-audience' ),
			esc_url( $url ),
			$more_follows
		);
	}

	/**
	 * Render a question followed by the "Manage your preferences" link.
	 *
	 * @param string $question_html Escaped lead-in question.
	 * @param string $url           Unescaped manage-subscription URL.
	 * @param string $style         Paragraph style.
	 * @return string Paragraph HTML.
	 */
	private function manage_preferences_html( $question_html, $url, $style ) {
		return EmailLayout::paragraph(
			$question_html . '
								<a href="' . esc_url( $url ) . '" style="color: #0073aa;">' . esc_html__( 'Manage your preferences', 'fair-audience' ) . '</a>',
			$style
		);
	}

	/**
	 * Render the event-invitation opt-out line, set off by a divider.
	 *
	 * @param string $url Unescaped manage-subscription URL.
	 * @return string Paragraph HTML.
	 */
	private function invitation_preferences_html( $url ) {
		return $this->manage_preferences_html(
			esc_html__( "Don't want to receive event invitations?", 'fair-audience' ),
			$url,
			'margin: 0; border-top: 1px solid #e0e0e0; padding-top: 15px;'
		);
	}

	/**
	 * Render the site-name footer line.
	 *
	 * @param string $site_name Unescaped site name.
	 * @return string Paragraph HTML.
	 */
	private function site_name_footer_html( $site_name ) {
		return EmailLayout::paragraph( esc_html( $site_name ), 'margin: 0;' );
	}

	/**
	 * Render the compact "Hi <name>," greeting used by short notices.
	 *
	 * Unlike {@see greeting_html()} it sets no font size of its own.
	 *
	 * @param string $name Unescaped recipient name.
	 * @return string Paragraph HTML.
	 */
	private function compact_greeting_html( $name ) {
		return '<p style="margin: 0 0 20px 0;">' . sprintf(
			/* translators: %s: participant first name */
			esc_html__( 'Hi %s,', 'fair-audience' ),
			'<strong>' . esc_html( $name ) . '</strong>'
		) . '</p>';
	}

	/**
	 * Send an email — the only wp_mail() call site in fair-audience.
	 *
	 * Enforces marketing consent for Participant recipients so no send path
	 * can bypass RecipientResolver::can_receive_email() by forgetting a
	 * caller-side check. Raw-address recipients (admin notifications, test
	 * sends) have no participant to check consent for and are sent
	 * unconditionally — callers must pass EmailType::MINIMAL for those.
	 *
	 * @param Participant|string $recipient  Participant (consent + valid-email checked) or a raw email address.
	 * @param string             $subject    Email subject.
	 * @param string             $message    Full HTML body.
	 * @param string             $email_type EmailType constant describing this send.
	 * @return string 'sent', 'skipped' (consent), or 'failed' (no valid email / wp_mail() failure).
	 */
	private function deliver( Participant|string $recipient, string $subject, string $message, string $email_type ): string {
		if ( $recipient instanceof Participant ) {
			if ( ! $this->has_valid_email( $recipient ) ) {
				return 'failed';
			}

			if ( ( EmailType::MARKETING === $email_type || EmailType::WEEKLY_SUMMARY === $email_type )
				&& ! $this->can_receive_email( $recipient, $email_type ) ) {
				return 'skipped';
			}

			$to = $recipient->email;
		} else {
			$to = $recipient;
		}

		$content_type = static function () {
			return 'text/html';
		};

		add_filter( 'wp_mail_content_type', $content_type );
		$result = wp_mail( $to, $subject, $this->append_branding_footer( $message ) );
		remove_filter( 'wp_mail_content_type', $content_type );

		return $result ? 'sent' : 'failed';
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
	 * @param string      $email_type    EmailType constant used for the consent check.
	 * @return bool Success.
	 */
	public function send_custom_mail_rendered( $participant, $subject, $content, $event_date_id = 0, $context = array(), $email_type = EmailType::MARKETING ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$content = $this->replace_placeholders( $content, $participant, $event_date_id, $context );
		$message = $this->build_custom_mail_html( $participant, $content );

		return 'sent' === $this->deliver( $participant, $subject, $message, $email_type );
	}

	/**
	 * Send a custom mail to a single participant.
	 *
	 * @param object      $event         Event post object.
	 * @param Participant $participant   Participant object.
	 * @param string      $subject       Email subject.
	 * @param string      $content       Email content (HTML).
	 * @param int         $event_date_id Event date ID for placeholder replacement.
	 * @param string      $email_type    EmailType constant used for the consent check.
	 * @return bool Success.
	 */
	public function send_custom_mail( $event, $participant, $subject, $content, $event_date_id = 0, $email_type = EmailType::MARKETING ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		// Replace participant-specific placeholders.
		$content = $this->replace_placeholders( $content, $participant, $event_date_id );
		$message = $this->build_custom_mail_html( $participant, $content );

		return 'sent' === $this->deliver( $participant, $subject, $message, $email_type );
	}

	/**
	 * Send bulk custom mail to event participants.
	 *
	 * Recipients come from the same RecipientResolver selection the preview
	 * shows: with an event date ID, only that occurrence's participants;
	 * without one, every participant of the event. Eligibility (valid email,
	 * marketing consent) is rechecked here for each recipient, so the preview
	 * is never what authorizes a send.
	 *
	 * @param int    $event_id     Event ID.
	 * @param string $subject      Email subject.
	 * @param string $content      Email content (HTML).
	 * @param bool   $is_marketing Whether to filter by marketing consent.
	 * @param array  $labels               Labels to include (e.g. 'signed_up', 'collaborator', 'interested').
	 * @param array  $skip_participant_ids  Participant IDs to skip.
	 * @param int    $event_date_id         Optional event date ID to limit recipients to.
	 * @param array  $group_ids             Optional group IDs to limit recipients to.
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

		$email_type           = $is_marketing ? EmailType::MARKETING : EmailType::MINIMAL;
		$skip_participant_ids = array_map( 'intval', (array) $skip_participant_ids );
		$recipients           = $this->preview_custom_mail_recipients( $event_id, $is_marketing, $labels, $group_ids, $event_date_id );
		$handled              = array();

		foreach ( $recipients as $recipient ) {
			$participant_id = (int) $recipient['participant_id'];

			// One delivery per participant, however many rows matched.
			if ( isset( $handled[ $participant_id ] ) ) {
				continue;
			}
			$handled[ $participant_id ] = true;

			$participant = $this->participant_repository->get_by_id( $participant_id );

			if ( ! $participant ) {
				$results['failed'][] = array(
					'name'   => '',
					'email'  => '',
					'reason' => __( 'Participant not found.', 'fair-audience' ),
				);
				continue;
			}

			// Skip manually excluded participants.
			if ( in_array( $participant_id, $skip_participant_ids, true ) ) {
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
					'email'  => (string) $participant->email,
					'reason' => __( 'Participant has no valid email address.', 'fair-audience' ),
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
			$success = $this->send_custom_mail( $event, $participant, $subject, $content, $event_date_id, $email_type );

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
	 * @param string        $subject      Email subject.
	 * @param string        $content      Email content (HTML).
	 * @param bool          $is_marketing         Whether to filter by marketing consent.
	 * @param array         $skip_participant_ids  Participant IDs to skip.
	 * @param array         $group_ids    Group IDs to filter by.
	 * @param string        $email_type   EmailType constant used for the consent check (defaults to MARKETING).
	 * @param callable|null $observer Optional; told about each participant as it is
	 *                                processed: see {@see WeeklyDigestMailer::send_to_subscribers_reporting()}.
	 * @param int|null      $weekly_feed_id Optional; send only to the participants this weekly email feed is
	 *                                      meant for ({@see WeeklyFeeds::in_scope()}). Others are not
	 *                                      recipients, so they are neither reported nor counted.
	 * @return array Results array with 'sent', 'failed', and 'skipped' keys.
	 */
	public function send_bulk_custom_mail_to_all( $subject, $content, $is_marketing = true, $skip_participant_ids = array(), $group_ids = array(), $email_type = EmailType::MARKETING, $observer = null, $weekly_feed_id = null ) {
		// Increase time limit for bulk sending.
		set_time_limit( 300 ); // 5 minutes.

		$results = array(
			'sent'    => array(),
			'failed'  => array(),
			'skipped' => array(),
		);

		// A weekly feed email always goes to that feed's subscribers only,
		// with the weekly checks: without a valid feed it reaches nobody.
		if ( EmailType::WEEKLY_SUMMARY === $email_type ) {
			$weekly_feed_id = max( 0, (int) $weekly_feed_id );
			$is_marketing   = true;
		}

		$participants          = $this->participant_repository->get_all();
		$group_participant_ids = $this->get_participant_ids_for_groups( $group_ids );
		$feed_subscriber_ids   = null !== $weekly_feed_id && $weekly_feed_id > 0 ? $this->participant_feed_repository->get_participant_ids_by_feed( (int) $weekly_feed_id ) : array();
		$deliver_email_type    = $is_marketing ? $email_type : EmailType::MINIMAL;
		$report                = static function ( $event, $participant, $reason = '' ) use ( $observer ) {
			if ( null === $observer ) {
				return;
			}
			$recipient = array(
				'id'    => (int) $participant->id,
				'name'  => (string) $participant->name,
				'email' => (string) $participant->email,
			);
			if ( '' !== $reason ) {
				$recipient['reason'] = $reason;
			}
			call_user_func( $observer, $event, $recipient );
		};

		foreach ( $participants as $participant ) {
			// Filter by group membership.
			if ( ! empty( $group_ids ) && ! in_array( $participant->id, $group_participant_ids, true ) ) {
				continue;
			}

			// Filter by the weekly email feed the participant chose.
			if ( null !== $weekly_feed_id && ! WeeklyFeeds::in_scope( $participant, (int) $weekly_feed_id, $feed_subscriber_ids ) ) {
				continue;
			}

			// Skip manually excluded participants.
			if ( ! empty( $skip_participant_ids ) && in_array( $participant->id, $skip_participant_ids, true ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => __( 'Manually skipped.', 'fair-audience' ),
				);
				$report( 'skipped', $participant, 'manually_skipped' );
				continue;
			}

			if ( ! $this->has_valid_email( $participant ) ) {
				$results['failed'][] = array(
					'name'   => $participant->name,
					'email'  => '',
					'reason' => __( 'Participant has no valid email address.', 'fair-audience' ),
				);
				$report( 'rejected', $participant, 'invalid_address' );
				continue;
			}

			// Check marketing consent if needed.
			if ( $is_marketing && ! $this->can_receive_email( $participant, $email_type ) ) {
				$results['skipped'][] = array(
					'name'   => $participant->name,
					'email'  => $participant->email,
					'reason' => $this->marketing_skip_reason( $participant, $email_type ),
				);
				$report( 'skipped', $participant, $this->marketing_skip_code( $participant, $email_type ) );
				continue;
			}

			// Send custom mail (no event context).
			$report( 'sending', $participant );
			$success = $this->send_custom_mail_without_event( $participant, $subject, $content, $deliver_email_type );
			$report( $success ? 'sent' : 'failed', $participant );

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
	 * @param string      $email_type  EmailType constant used for the consent check.
	 * @return bool Success.
	 */
	public function send_custom_mail_without_event( $participant, $subject, $content, $email_type = EmailType::MARKETING ) {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		// Replace participant-specific placeholders.
		$content = $this->replace_placeholders( $content, $participant );
		$message = $this->build_custom_mail_html( $participant, $content );

		return 'sent' === $this->deliver( $participant, $subject, $message, $email_type );
	}

	/**
	 * Preview recipients for bulk custom mail to event participants.
	 *
	 * @param int   $event_id      Event ID.
	 * @param bool  $is_marketing  Whether to filter by marketing consent.
	 * @param array $labels        Labels to include.
	 * @param array $group_ids     Optional group IDs to limit recipients to.
	 * @param int   $event_date_id Optional event date ID; when set, only that
	 *                             occurrence's participants are returned.
	 * @return array List of recipient info arrays.
	 */
	public function preview_custom_mail_recipients( $event_id, $is_marketing = true, $labels = array( 'signed_up', 'collaborator' ), $group_ids = array(), $event_date_id = 0 ) {
		$filter = array(
			'labels'       => $labels,
			'group_ids'    => $group_ids,
			'is_marketing' => $is_marketing,
		);

		if ( ! empty( $event_date_id ) ) {
			return $this->recipient_resolver->resolve_by_event_date( $filter, $event_date_id );
		}

		return $this->recipient_resolver->resolve( $filter, $event_id );
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

		$rows = array(
			array( esc_html__( 'Fee:', 'fair-audience' ), esc_html( $fee->name ) ),
			array( esc_html__( 'Amount:', 'fair-audience' ), esc_html( Money::format_display( (float) $fee_payment->amount, $fee->currency ) ) ),
		);
		if ( ! empty( $fee->due_date ) ) {
			$rows[] = array( esc_html__( 'Due Date:', 'fair-audience' ), esc_html( $fee->due_date ) );
		}

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph( esc_html__( 'This is a friendly reminder about a pending payment:', 'fair-audience' ) )
			. EmailLayout::details_table( $rows );
		$footer  = '';

		// Add "Pay Now" button if fair-payments-connector plugin is active.
		if ( function_exists( 'fair_payment_create_transaction' ) ) {
			$payment_url = FeePaymentToken::get_url( $fee_payment->id );
			$content    .= EmailLayout::button( esc_url( $payment_url ), esc_html__( 'Pay Now', 'fair-audience' ) );
			$footer      = $this->button_fallback_html( $payment_url, true );
		}

		$content .= $this->thanks_html( $site_name, EmailLayout::NOTE );
		$footer  .= $this->site_name_footer_html( $site_name );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $footer );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
					'reason' => __( 'Participant has no valid email address.', 'fair-audience' ),
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
	 * @deprecated Superseded by fair-form's own `FormNotificationService`
	 * (ticket #1212), which decouples the notification from participant
	 * creation and drops fair-form's dependency on this plugin. An updated
	 * fair-form never calls this method regardless of fair-audience's
	 * version — it's kept (with its DEFERRABLE_METHODS entry) for the
	 * opposite pairing: a site whose fair-form is not yet updated but whose
	 * fair-audience is, and for any `fair_audience_send_deferred_email` cron
	 * events already queued against this method before the upgrade. Removal
	 * is a follow-up cleanup ticket.
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
		$submitter_html = QuestionnaireAnswerRows::row(
			esc_html__( 'Name', 'fair-audience' ),
			esc_html( trim( $submitter_name . ' ' . $submitter_surname ) )
		)
			. QuestionnaireAnswerRows::row(
				esc_html__( 'Email', 'fair-audience' ),
				'<a href="mailto:' . esc_attr( $submitter_email ) . '" style="color: #0073aa;">' . esc_html( $submitter_email ) . '</a>'
			);

		$answers_html = QuestionnaireAnswerRows::html( $answers );

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

		$message = FormSubmissionEmail::html(
			array(
				'site_name'      => esc_html( $site_name ),
				'intro'          => esc_html__( 'A new form submission has been received.', 'fair-audience' ),
				'context_html'   => $context_html,
				'submitter_html' => $submitter_html,
				'answers_html'   => $answers_html,
			)
		);

		return 'sent' === $this->deliver( $to_email, $subject, $message, EmailType::MINIMAL );
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

		$content = '<div style="margin: 0; font-size: 16px;">
								' . wp_kses_post( $content ) . '
							</div>';

		$footer = $this->site_name_footer_html( $site_name )
			. EmailLayout::paragraph(
				esc_html__( '[Test email — real sends to subscribers include a "Manage your preferences" unsubscribe link here.]', 'fair-audience' ),
				'margin: 10px 0 0 0; font-style: italic;'
			);

		$message = EmailLayout::document( esc_html( $site_name ), $content, $footer );

		return 'sent' === $this->deliver( $to_email, $subject, $message, EmailType::MINIMAL );
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

		$answers_html = QuestionnaireAnswerRows::html( $answers );

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

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph( esc_html__( 'Thank you for your submission! We have received your response.', 'fair-audience' ) )
			. $context_html;

		if ( ! empty( $answers_html ) ) {
			$content .= EmailLayout::paragraph( esc_html__( 'Here are the answers you submitted:', 'fair-audience' ), 'margin: 0 0 10px 0; font-size: 16px;' )
				. EmailLayout::answers_table( $answers_html );
		}

		$content .= $this->thanks_html( $site_name );

		$message = EmailLayout::document( esc_html( $site_name ), $content, $this->site_name_footer_html( $site_name ) );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
	}

	/**
	 * Send signup confirmation email to the participant.
	 *
	 * @param Participant   $participant             Participant who signed up.
	 * @param \WP_Post|null $event                   Event post object (nullable).
	 * @param object|null   $transaction             Transaction row from fair-payments-connector (null for free signups).
	 * @param array         $option_names            Names of the selected ticket-activity options.
	 * @param int           $event_date_id           Event date ID — used to load the event date
	 *                                                and the signup questionnaire answers. Pass 0 to skip both.
	 * @param int           $ticket_type_id           Ticket type ID shown in the email. Pass 0 to omit.
	 * @param int           $registration_reference  EventParticipant row ID shown as the registration
	 *                                                reference. Pass 0 to omit.
	 * @return bool Success.
	 */
	public function send_signup_payment_confirmation( Participant $participant, $event, $transaction = null, $option_names = array(), int $event_date_id = 0, int $ticket_type_id = 0, int $registration_reference = 0 ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event ? $event->post_title : __( 'Event', 'fair-audience' );

		$subject_template =
			/* translators: %s: event title */
			__( 'Signup confirmed — %s', 'fair-audience' );

		$event_date_display = '';
		$event_url          = '';
		if ( $event_date_id > 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_url = (string) $event_date->get_display_url();

				if ( method_exists( \FairEvents\Helpers\DateHelper::class, 'format_local_datetime' ) ) {
					// A date without a start time (or an all-day one) shows
					// the date alone, never a midnight that was not set.
					$has_start_time     = ! empty( $event_date->start_time ) && empty( $event_date->all_day );
					$event_date_display = empty( $event_date->start_date ) ? '' : \FairEvents\Helpers\DateHelper::format_local_datetime(
						$event_date->start_date . ' ' . ( $has_start_time ? $event_date->start_time : '00:00:00' ),
						$has_start_time ? get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) : get_option( 'date_format' )
					);
				}
			}
		}

		$ticket_type_name = '';
		if ( $ticket_type_id > 0 && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type ) {
				$ticket_type_name = $ticket_type->name;
			}
		}

		$amount                 = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency               = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';
		$payment_amount_display = $amount > 0 ? Money::format_display( $amount, $currency ) : '';

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
				$answer_repo  = new \FairForm\Database\QuestionnaireAnswerRepository();
				$answers_html = QuestionnaireAnswerRows::html( $answer_repo->get_by_submission( $submissions[0]->id ) );
			}
		}

		$confirmation_sentence = sprintf(
			$transaction
				/* translators: %s: event title */
				? esc_html__( 'Your signup for %s has been confirmed and your payment has been received.', 'fair-audience' )
				/* translators: %s: event title */
				: esc_html__( 'Your signup for %s has been confirmed.', 'fair-audience' ),
			SignupConfirmationEmail::linked_event_title( esc_html( $event_title ), esc_url( $event_url ) )
		);

		// The organizer's own message for this event, resolved and sanitized
		// by fair-events so both confirmation senders include the same
		// content (#2126).
		$custom_message_html = '';
		if ( $event_date_id > 0 && class_exists( \FairEvents\Services\BookingMessage::class ) ) {
			$custom_message_html = \FairEvents\Services\BookingMessage::for_email( $event_date_id );
		}

		$subject = SignupConfirmationEmail::subject( $subject_template, $event_title );
		$message = BookingConfirmationEmail::html(
			array(
				'event_title'                  => esc_html( $event_title ),
				'participant_name'             => esc_html( $participant->name ),
				'site_name'                    => esc_html( $site_name ),
				'event_date_display'           => esc_html( $event_date_display ),
				'registration_reference'       => $registration_reference > 0 ? '#' . $registration_reference : '',
				'ticket_type_name'             => esc_html( $ticket_type_name ),
				'payment_amount_display'       => esc_html( $payment_amount_display ),
				'option_names'                 => array_map( 'esc_html', $option_names ),
				'answers_html'                 => $answers_html,
				'custom_message_html'          => $custom_message_html,
				/* translators: %s: participant first name */
				'greeting_template'            => esc_html__( 'Hi %s,', 'fair-audience' ),
				'confirmation_sentence'        => $confirmation_sentence,
				'event_date_label'             => esc_html__( 'Event date:', 'fair-audience' ),
				'registration_reference_label' => esc_html__( 'Registration reference:', 'fair-audience' ),
				'ticket_type_label'            => esc_html__( 'Ticket type:', 'fair-audience' ),
				'amount_paid_label'            => esc_html__( 'Amount paid:', 'fair-audience' ),
				'selected_options_label'       => esc_html__( 'Selected options:', 'fair-audience' ),
				'your_answers_label'           => esc_html__( 'Your answers:', 'fair-audience' ),
				/* translators: 1: line break, 2: site name */
				'sign_off_template'            => esc_html__( 'See you there!%1$sThe %2$s Team', 'fair-audience' ),
			)
		);

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
	 * @param int           $event_date_id     Event date ID — used only to link the event
	 *                                          name in the body sentence. Pass 0 to omit the link.
	 * @return bool Success.
	 */
	public function send_activities_added_confirmation( Participant $participant, $event, $transaction = null, $added_option_names = array(), int $event_date_id = 0 ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name   = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$event_title = $event ? $event->post_title : __( 'Event', 'fair-audience' );

		$event_url = '';
		if ( $event_date_id > 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_url = (string) $event_date->get_display_url();
			}
		}

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Activities added — %s', 'fair-audience' ),
			$event_title
		);

		$amount   = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: event title */
					esc_html__( 'The following activities have been added to your signup for %s.', 'fair-audience' ),
					SignupConfirmationEmail::linked_event_title( esc_html( $event_title ), esc_url( $event_url ) )
				)
			);

		if ( ! empty( $added_option_names ) ) {
			$options_list = '';
			foreach ( $added_option_names as $name ) {
				$options_list .= '<li style="padding: 4px 0;">' . esc_html( $name ) . '</li>';
			}
			$content .= '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . esc_html__( 'Activities added:', 'fair-audience' ) . '</p>
							<ul style="margin: 0 0 20px 20px; padding: 0;">' . $options_list . '</ul>';
		}

		if ( $amount > 0 ) {
			$content .= EmailLayout::details_table(
				array(
					array( esc_html__( 'Amount paid:', 'fair-audience' ), esc_html( Money::format_display( $amount, $currency ) ) ),
				)
			);
		}

		$content .= $this->see_you_there_html( $site_name );

		$message = EmailLayout::document( esc_html( $event_title ), $content, $this->site_name_footer_html( $site_name ) );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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

		$event_url = '';
		if ( $event_date_id > 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_url = (string) $event_date->get_display_url();
			}
		}

		$subject = sprintf(
			/* translators: %s: event title */
			__( 'Payment didn’t go through — %s', 'fair-audience' ),
			$event_title
		);

		$amount   = isset( $transaction->amount ) ? (float) $transaction->amount : 0;
		$currency = ! empty( $transaction->currency ) ? $transaction->currency : 'EUR';

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: event title */
					esc_html__( 'Your payment for %s didn’t go through. Your spot is still held for a short while — pick up where you left off using the link below.', 'fair-audience' ),
					SignupConfirmationEmail::linked_event_title( esc_html( $event_title ), esc_url( $event_url ) )
				)
			);

		if ( $amount > 0 ) {
			$content .= EmailLayout::details_table(
				array(
					array( esc_html__( 'Amount:', 'fair-audience' ), esc_html( Money::format_display( $amount, $currency ) ) ),
				)
			);
		}

		// This notice keeps its own larger button and inline link fallback.
		$content .= '
							<p style="margin: 30px 0; text-align: center;">
								<a href="' . esc_url( $resume_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 4px; font-weight: bold; font-size: 16px;">
									' . esc_html__( 'Resume payment', 'fair-audience' ) . '
								</a>
							</p>'
			. EmailLayout::paragraph(
				esc_html__( 'If the button doesn’t work, copy and paste this link into your browser:', 'fair-audience' ) . '<br>
								<a href="' . esc_url( $resume_url ) . '" style="color: #0073aa; word-break: break-all;">' . esc_html( $resume_url ) . '</a>',
				EmailLayout::SIGN_OFF
			)
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: site name */
					esc_html__( 'See you soon,%1$sThe %2$s Team', 'fair-audience' ),
					'<br>',
					esc_html( $site_name )
				),
				EmailLayout::SIGN_OFF
			);

		$message = EmailLayout::document( esc_html( $event_title ), $content, $this->site_name_footer_html( $site_name ), EmailLayout::HEADER_COLOR_ALERT );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
	}

	/**
	 * Preview recipients for bulk custom mail to all audience.
	 *
	 * @param bool  $is_marketing Whether to filter by marketing consent.
	 * @param array $group_ids    Optional group IDs to limit recipients to.
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
	 * Send event invitation to a single participant.
	 *
	 * This is a marketing email for participants who subscribed to updates.
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

		$content = $this->greeting_html( $participant->name )
			. EmailLayout::paragraph(
				sprintf(
					/* translators: %s: event title */
					esc_html__( 'We have a new event coming up: %s.', 'fair-audience' ),
					'<strong>' . esc_html( $event->post_title ) . '</strong>'
				)
			);

		if ( ! empty( $custom_message ) ) {
			$content .= EmailLayout::paragraph( nl2br( esc_html( $custom_message ) ) );
		}

		$content .= EmailLayout::paragraph( esc_html__( 'Would you like to join? Click the button below to sign up:', 'fair-audience' ) )
			. EmailLayout::button( esc_url( $signup_url ), esc_html__( 'Sign Up Now', 'fair-audience' ) )
			. $this->see_you_there_html( $site_name );

		$footer = $this->button_fallback_html( $signup_url, true )
			. $this->invitation_preferences_html( $manage_subscription_url );

		$message = EmailLayout::document( esc_html( $event->post_title ), $content, $footer );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MARKETING );
	}

	/**
	 * Resolve who an event invitation would reach, without sending anything.
	 *
	 * Shared by the invitation preview and the send itself, so the summary an
	 * organizer reviews is computed exactly as the send decides. Selected
	 * participants and group members are deduplicated by participant ID; each
	 * one is then either eligible or excluded for exactly one reason, checked
	 * in this order: already signed up to the date, participant gone, no valid
	 * email, no confirmed marketing consent.
	 *
	 * @param int   $event_id        Event post ID.
	 * @param array $participant_ids Participant IDs selected directly.
	 * @param array $group_ids       Group IDs whose members are selected.
	 * @param bool  $skip_signed_up  Whether people already signed up are excluded.
	 * @param int   $event_date_id   Occurrence to scope to; when 0, the event's
	 *                               own date row is used.
	 * @return array{event_date_id: int, group_membership_count: int, candidate_count: int, eligible: Participant[], excluded: array<int, array{reason: string, participant_id: int, participant: Participant|null}>}
	 */
	public function resolve_event_invitation_recipients(
		$event_id,
		$participant_ids = array(),
		$group_ids = array(),
		$skip_signed_up = true,
		$event_date_id = 0
	) {
		// Collect all participant IDs.
		$all_participant_ids    = array_map( 'intval', (array) $participant_ids );
		$group_membership_count = 0;

		// Expand group IDs to participant IDs.
		if ( $this->group_participant_repository ) {
			foreach ( (array) $group_ids as $group_id ) {
				$members = $this->group_participant_repository->get_by_group( $group_id );
				foreach ( $members as $member ) {
					$all_participant_ids[] = (int) $member->participant_id;
					++$group_membership_count;
				}
			}
		}

		// Deduplicate participant IDs.
		$all_participant_ids = array_values( array_unique( $all_participant_ids ) );

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

		$resolved = array(
			'event_date_id'          => $event_date_id,
			'group_membership_count' => $group_membership_count,
			'candidate_count'        => count( $all_participant_ids ),
			'eligible'               => array(),
			'excluded'               => array(),
		);

		if ( empty( $all_participant_ids ) ) {
			return $resolved;
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
					$signed_up_ids[] = (int) $ep->participant_id;
				}
			}
		}

		foreach ( $all_participant_ids as $participant_id ) {
			$participant = $this->participant_repository->get_by_id( $participant_id );

			if ( $skip_signed_up && in_array( $participant_id, $signed_up_ids, true ) ) {
				$reason = self::INVITATION_EXCLUDED_SIGNED_UP;
			} elseif ( ! $participant ) {
				$reason = self::INVITATION_EXCLUDED_UNAVAILABLE;
			} elseif ( ! $this->has_valid_email( $participant ) ) {
				$reason = self::INVITATION_EXCLUDED_INVALID_EMAIL;
			} elseif ( ! $this->can_receive_email( $participant, EmailType::MARKETING ) ) {
				$reason = self::INVITATION_EXCLUDED_NO_CONSENT;
			} else {
				$resolved['eligible'][] = $participant;
				continue;
			}

			$resolved['excluded'][] = array(
				'reason'         => $reason,
				'participant_id' => $participant_id,
				'participant'    => $participant ? $participant : null,
			);
		}

		return $resolved;
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

		$recipients = $this->resolve_event_invitation_recipients(
			$event_id,
			$participant_ids,
			$group_ids,
			$skip_signed_up,
			$event_date_id
		);

		foreach ( $recipients['excluded'] as $excluded ) {
			$participant = $excluded['participant'];

			switch ( $excluded['reason'] ) {
				case self::INVITATION_EXCLUDED_SIGNED_UP:
					$results['skipped'][] = array(
						'name'   => $participant ? $participant->name : '',
						'email'  => $participant ? $participant->email : '',
						'reason' => __( 'Already signed up', 'fair-audience' ),
					);
					break;

				case self::INVITATION_EXCLUDED_UNAVAILABLE:
					$results['failed'][] = array(
						'name'   => '',
						'email'  => '',
						'reason' => __( 'Participant not found.', 'fair-audience' ),
					);
					break;

				case self::INVITATION_EXCLUDED_INVALID_EMAIL:
					$results['failed'][] = array(
						'name'   => $participant->name,
						'email'  => '',
						'reason' => __( 'Participant has no valid email address.', 'fair-audience' ),
					);
					break;

				default:
					$results['skipped'][] = array(
						'name'   => $participant->name,
						'email'  => $participant->email,
						'reason' => $this->marketing_skip_reason( $participant ),
					);
			}
		}

		$event_date_id = $recipients['event_date_id'];

		foreach ( $recipients['eligible'] as $participant ) {
			// Generate participant token URL.
			$token_url = ParticipantToken::get_url( (int) $participant->id, $event_date_id, $event->ID );

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

		$event_url = '';
		if ( $event_date_id > 0 && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_url = (string) $event_date->get_display_url();
			}
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

		$intro = sprintf(
			/* translators: %s: event title */
			esc_html__( 'Thanks for registering your interest in %s. We will let you know when there are updates.', 'fair-audience' ),
			SignupConfirmationEmail::linked_event_title( esc_html( $event_title ), esc_url( $event_url ) )
		);

		$content = $this->compact_greeting_html( $greeting_name ) . '
							<p style="margin: 0 0 20px 0;">' . $intro . '</p>
							<p style="margin: 0 0 10px 0; font-size: 14px; color: #666666;">' . esc_html__( "If you didn't register your interest, you can safely ignore this email.", 'fair-audience' ) . '</p>';

		$footer = EmailLayout::footer_link(
			esc_html__( 'No longer interested?', 'fair-audience' ),
			esc_url( $unsubscribe_url ),
			esc_html__( 'Unsubscribe from updates about this event', 'fair-audience' )
		);

		$message = EmailLayout::document( esc_html( $event_title ), $content, $footer );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
		$event_url   = $event_id ? (string) get_permalink( $event_id ) : '';

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
				SignupConfirmationEmail::linked_event_title( esc_html( $event_title ), esc_url( $event_url ) )
			);
		} else {
			$intro = sprintf(
				/* translators: %s: site name */
				esc_html__( 'You\'ve been added to the %s mailing list following the consent you gave. We\'ll keep you posted about upcoming events and news.', 'fair-audience' ),
				'<strong>' . esc_html( $site_name ) . '</strong>'
			);
		}

		$content = $this->compact_greeting_html( $greeting_name ) . '
							<p style="margin: 0 0 20px 0;">' . $intro . '</p>';

		$footer = EmailLayout::footer_link(
			esc_html__( 'Changed your mind?', 'fair-audience' ),
			esc_url( $manage_subscription_url ),
			esc_html__( 'Manage your subscription or unsubscribe', 'fair-audience' )
		);

		$message = EmailLayout::document( esc_html( $site_name ), $content, $footer );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
	}

	/**
	 * Send the link to the subscription-management page.
	 *
	 * Sent when someone signs up with an address that is already subscribed
	 * and submits email preferences: only the owner of the address may
	 * change them, on the page this link opens.
	 *
	 * @param Participant $participant Subscribed participant.
	 * @return bool True if mail dispatched.
	 */
	public function send_manage_subscription_link( Participant $participant ): bool {
		if ( ! $this->has_valid_email( $participant ) ) {
			return false;
		}

		$site_name               = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		$manage_subscription_url = ManageSubscriptionToken::get_url( (int) $participant->id );
		$greeting_name           = ! empty( $participant->name ) ? $participant->name : __( 'there', 'fair-audience' );

		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Your %s email preferences', 'fair-audience' ),
			$site_name
		);

		$content = $this->compact_greeting_html( $greeting_name ) . '
							<p style="margin: 0 0 20px 0;">' . esc_html__( 'Someone asked to subscribe this address, which is already subscribed. Nothing was changed. To review or change which emails you receive, open your subscription page.', 'fair-audience' ) . '</p>
							<p style="margin: 0 0 20px 0; text-align: center;"><a href="' . esc_url( $manage_subscription_url ) . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; padding: 12px 24px; border-radius: 4px; text-decoration: none;">' . esc_html__( 'Manage your subscription', 'fair-audience' ) . '</a></p>
							<p style="margin: 0; font-size: 14px; color: #666666;">' . esc_html__( 'If you did not ask for this, you can ignore this email.', 'fair-audience' ) . '</p>';

		$message = EmailLayout::document( esc_html( $site_name ), $content );

		return 'sent' === $this->deliver( $participant, $subject, $message, EmailType::MINIMAL );
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
		'send_manage_subscription_link',
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
