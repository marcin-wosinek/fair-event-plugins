<?php
/**
 * Scheduled Message Hooks
 *
 * Drives scheduled per-event mailings: a single recurring cron claims due
 * messages and sends them, a reaper reclaims rows stuck mid-send, and anchor
 * change / deletion hooks keep send times correct.
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Hooks;

use FairAudienceExperimental\Database\ScheduledMessageRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Services\RecipientResolver;
use FairAudienceExperimental\Services\ScheduledMessageScheduler;
use FairAudience\Services\EmailService;
use FairAudienceExperimental\Models\ScheduledMessage;

defined( 'WPINC' ) || die;

/**
 * Hooks for the scheduled mailing sender and reschedule logic.
 */
class ScheduledMessageHooks {

	/**
	 * Cron hook name for the recurring sender.
	 */
	const CRON_HOOK = 'fair_audience_send_scheduled_messages';

	/**
	 * Max rows claimed (and sent) per cron tick.
	 */
	const BATCH_SIZE = 20;

	/**
	 * Minutes before a row stuck in 'sending' is reclaimed.
	 */
	const STUCK_THRESHOLD_MINUTES = 30;

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );

		add_action( self::CRON_HOOK, array( static::class, 'run_due' ) );
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fair_audience_every_five_minutes', self::CRON_HOOK );
		}

		// Reschedule when the underlying anchor moves; cancel when it disappears.
		// A mailing is scoped to a single event date, so deleting that date
		// (which fires for every date when the parent event is deleted) cancels
		// its mailings — no separate post-deletion hook is needed.
		add_action( 'fair_events_event_date_updated', array( static::class, 'handle_event_date_changed' ) );
		add_action( 'fair_events_event_date_deleted', array( static::class, 'handle_event_date_deleted' ) );
	}

	/**
	 * Register the shared 5-minute cron schedule.
	 *
	 * Mirrors PaymentHooks::add_cron_schedule so the sender works even if that
	 * hook set isn't active. Adding the same key twice is a no-op.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules['fair_audience_every_five_minutes'] ) ) {
			$schedules['fair_audience_every_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience-experimental' ),
			);
		}
		return $schedules;
	}

	/**
	 * Cron tick: reclaim stuck rows, claim due rows, send each.
	 */
	public static function run_due() {
		$repository = new ScheduledMessageRepository();

		// Recover rows abandoned mid-send by a previous crashed tick.
		$repository->reclaim_stuck( self::STUCK_THRESHOLD_MINUTES );

		$claimed = $repository->claim_due( self::BATCH_SIZE );

		$email_service = new EmailService();
		$resolver      = new RecipientResolver();
		$participants  = new ParticipantRepository();

		foreach ( $claimed as $message ) {
			self::send_message( $message, $email_service, $resolver, $participants );
		}
	}

	/**
	 * Resolve, render, and send one claimed message; record the outcome.
	 *
	 * @param ScheduledMessage      $message       Claimed message (status='sending').
	 * @param EmailService          $email_service Mailer.
	 * @param RecipientResolver     $resolver      Recipient resolver.
	 * @param ParticipantRepository $participants  Participant lookup.
	 */
	private static function send_message( ScheduledMessage $message, EmailService $email_service, RecipientResolver $resolver, ParticipantRepository $participants ) {
		$sent    = 0;
		$failed  = 0;
		$skipped = 0;

		try {
			$context    = self::build_context( $message );
			$recipients = $resolver->resolve_by_event_date( $message->recipients_filter, $message->event_date_id );

			foreach ( $recipients as $recipient ) {
				if ( empty( $recipient['has_valid_email'] ) ) {
					++$failed;
					continue;
				}

				if ( ! empty( $recipient['would_skip_marketing'] ) ) {
					++$skipped;
					continue;
				}

				$participant = $participants->get_by_id( (int) $recipient['participant_id'] );
				if ( ! $participant ) {
					++$failed;
					continue;
				}

				$success = $email_service->send_custom_mail_rendered(
					$participant,
					$message->subject,
					$message->body,
					(int) $message->event_date_id,
					$context
				);

				if ( $success ) {
					++$sent;
				} else {
					++$failed;
				}
			}

			$message->sent_count    = $sent;
			$message->failed_count  = $failed;
			$message->skipped_count = $skipped;
			$message->status        = 'sent';
			$message->sent_at       = current_time( 'mysql' );
			$message->last_error    = null;
			$message->save();
		} catch ( \Throwable $e ) {
			$message->sent_count    = $sent;
			$message->failed_count  = $failed;
			$message->skipped_count = $skipped;
			$message->status        = 'failed';
			$message->last_error    = $e->getMessage();
			$message->save();
		}
	}

	/**
	 * Build per-message placeholder context (event_name, event_date).
	 *
	 * @param ScheduledMessage $message Message.
	 * @return array Context array.
	 */
	private static function build_context( ScheduledMessage $message ) {
		$event_name = '';
		$event_date = '';

		if ( $message->event_date_id ) {
			global $wpdb;
			$table = $wpdb->prefix . 'fair_event_dates';

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$row = $wpdb->get_row(
				$wpdb->prepare( 'SELECT start_datetime, event_id FROM %i WHERE id = %d', $table, $message->event_date_id ),
				ARRAY_A
			);

			if ( $row ) {
				if ( ! empty( $row['start_datetime'] ) ) {
					$event_date = wp_date( 'Y-m-d H:i', strtotime( $row['start_datetime'] ) );
				}

				// Resolve the event name from the date's linked post, when present.
				if ( ! empty( $row['event_id'] ) ) {
					$event = get_post( (int) $row['event_id'] );
					if ( $event ) {
						$event_name = $event->post_title;
					}
				}
			}
		}

		return array(
			'event_name' => $event_name,
			'event_date' => $event_date,
		);
	}

	/**
	 * Recompute send times for messages anchored to a moved event date.
	 *
	 * @param int $event_date_id Event date row ID.
	 */
	public static function handle_event_date_changed( $event_date_id ) {
		$repository = new ScheduledMessageRepository();
		$scheduler  = new ScheduledMessageScheduler();

		foreach ( ScheduledMessageScheduler::EVENT_DATE_ANCHORS as $anchor_type ) {
			$messages = $repository->get_scheduled_by_anchor( $anchor_type, (int) $event_date_id );
			foreach ( $messages as $message ) {
				$scheduler->recompute( $message );
			}
		}
	}

	/**
	 * Cancel messages anchored to a deleted event date.
	 *
	 * @param int $event_date_id Event date row ID.
	 */
	public static function handle_event_date_deleted( $event_date_id ) {
		$repository = new ScheduledMessageRepository();

		foreach ( ScheduledMessageScheduler::EVENT_DATE_ANCHORS as $anchor_type ) {
			$messages = $repository->get_scheduled_by_anchor( $anchor_type, (int) $event_date_id );
			foreach ( $messages as $message ) {
				$message->status = 'canceled';
				$message->save();
			}
		}
	}
}
