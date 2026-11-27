<?php
/**
 * Sends scheduled sharing reminders.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

use FairEventsExperimental\Frontend\WeeklySummaryPage;
use FairEventsExperimental\Services\WeeklySummary;

defined( 'WPINC' ) || die;

/**
 * Runs one feed's scheduled reminder for one week.
 *
 * The reminder and everything it depends on are read again at run time.
 * The (feed, week) pair is claimed before any check or request to Meta, so
 * a duplicate cron run, a replay or a run after the collaborator changed
 * never sends a second time; the claim records why a run was skipped or
 * failed, or which delivery it started.
 *
 * The message is the feed's approved template, sent without parameters
 * through the same client and delivery records as test sends. Its static
 * button opens the feed's weekly-summary page, which shows the current week
 * whenever it is opened. Nothing is retried.
 */
class ReminderDispatcher {

	/** Skip reasons: nothing was sent and nothing needs fixing in WhatsApp. */
	public const SKIP_REASONS = array( 'feed_unavailable', 'no_recipient', 'recipient_unavailable', 'recipient_needs_confirmation', 'no_template', 'template_url_changed', 'summary_unavailable', 'empty_week' );

	/**
	 * Delivery records.
	 *
	 * @var Deliveries
	 */
	private $deliveries;

	/**
	 * Run claims.
	 *
	 * @var ReminderRuns
	 */
	private $runs;

	/**
	 * Constructor.
	 *
	 * @param Deliveries|null   $deliveries Delivery records.
	 * @param ReminderRuns|null $runs       Run claims.
	 */
	public function __construct( $deliveries = null, $runs = null ) {
		$this->deliveries = $deliveries ? $deliveries : new Deliveries();
		$this->runs       = $runs ? $runs : new ReminderRuns();
	}

	/**
	 * Cron callback.
	 *
	 * @param string $send_week ISO week the run was queued for.
	 * @param int    $source_id Event feed ID.
	 * @return array{state: string, reason: string, run_id: int} What the
	 *     run did; state 'inactive' when the reminder is gone or off and
	 *     'duplicate' when the week was already claimed.
	 */
	public function run( $send_week, $source_id ) {
		$source_id = absint( $source_id );
		$send_week = (string) $send_week;
		$reminder  = SharingReminders::get( $source_id );
		if ( ! $reminder ) {
			ReminderSchedule::unschedule( $source_id );
			return self::result( 'inactive' );
		}

		// Queue the next run first, so a failure below never stops the cycle.
		ReminderSchedule::advance( $source_id, $reminder, ReminderSchedule::now() );
		if ( ! $reminder['enabled'] || ! preg_match( '/^\d{4}-W\d{2}$/', $send_week ) ) {
			return self::result( 'inactive' );
		}

		$run_id = $this->runs->claim( $source_id, $send_week );
		if ( ! $run_id ) {
			return self::result( 'duplicate' );
		}

		$outcome = $this->attempt( $source_id, $send_week, $reminder, $run_id );
		$this->runs->update( $run_id, $outcome );
		return self::result( $outcome['state'], $outcome['reason'] ?? '', $run_id );
	}

	/**
	 * Check every prerequisite of a claimed run, then send.
	 *
	 * @param int    $source_id Event feed ID.
	 * @param string $send_week ISO week.
	 * @param array  $reminder  Normalized reminder.
	 * @param int    $run_id    Claimed run.
	 * @return array Fields for {@see ReminderRuns::update()}.
	 */
	private function attempt( $source_id, $send_week, array $reminder, $run_id ) {
		$source = self::source( $source_id );
		if ( null === $source ) {
			// The feed was deleted: its reminder can never run again.
			SharingReminders::delete( $source_id );
			ReminderSchedule::unschedule( $source_id );
			return self::skip( 'feed_unavailable' );
		}
		if ( ! $source || empty( $source['enabled'] ) ) {
			return self::skip( 'feed_unavailable' );
		}

		$destination = SharingReminders::destination( $reminder );
		$base        = array();
		if ( '' !== $destination['digits'] ) {
			$base['recipient'] = Client::mask_recipient( $destination['digits'] );
		}
		if ( 'none' === $destination['status'] ) {
			return self::skip( 'no_recipient' );
		}
		if ( 'needs_confirmation' === $destination['status'] ) {
			return self::skip( 'recipient_needs_confirmation', $base );
		}
		if ( 'ok' !== $destination['status'] ) {
			return self::skip( 'recipient_unavailable', $base );
		}

		$template = $reminder['template'];
		if ( ! $template ) {
			return self::skip( 'no_template', $base );
		}
		$base['template_name']     = $template['name'];
		$base['template_language'] = $template['language'];
		$expected_url              = WeeklySummaryPage::url( (string) $source['slug'] );
		if ( ! SharingReminders::same_url( $template['url'], $expected_url ) ) {
			return self::skip( 'template_url_changed', $base );
		}

		$summary = ( new WeeklySummary() )->build( (string) $source['slug'], $send_week );
		if ( is_wp_error( $summary ) ) {
			return self::skip( 'summary_unavailable', $base );
		}
		if ( empty( $summary['events'] ) ) {
			return self::skip( 'empty_week', $base );
		}

		if ( ! Connector::status()['configured'] || ! Configuration::validation() ) {
			return self::fail( 'whatsapp_not_ready', $base );
		}
		$ids       = Configuration::ids();
		$client    = new Client( Connector::token() );
		$templates = $client->templates( $ids['waba_id'] );
		if ( ! $templates['ok'] ) {
			return self::fail( 'templates_' . $templates['code'], $base );
		}
		if ( ! self::offered( $templates['templates'], $template, $expected_url ) ) {
			return self::fail( 'template_invalid', $base );
		}

		$delivery = $this->deliveries->start(
			array(
				'origin'            => 'scheduled',
				'waba_id'           => $ids['waba_id'],
				'phone_number_id'   => $ids['phone_number_id'],
				'template_name'     => $template['name'],
				'template_language' => $template['language'],
				'recipient'         => $base['recipient'],
			)
		);
		if ( ! $delivery ) {
			return self::fail( 'not_recorded', $base );
		}
		// Recorded before the request: a run interrupted from here on is
		// shown as uncertain and never sent again.
		$this->runs->update(
			$run_id,
			array_merge(
				$base,
				array(
					'state'       => ReminderRuns::SENDING,
					'delivery_id' => $delivery,
				)
			)
		);

		$result = $client->send_template( $ids['phone_number_id'], $destination['digits'], $template['name'], $template['language'] );
		$this->deliveries->finish( $delivery, $result );

		$state = in_array( $result['outcome'] ?? '', array( ReminderRuns::ACCEPTED, ReminderRuns::NOT_ACCEPTED ), true ) ? $result['outcome'] : ReminderRuns::UNCERTAIN;
		return array_merge(
			$base,
			array(
				'state'  => $state,
				'reason' => $result['ok'] ? '' : (string) ( $result['code'] ?? '' ),
			)
		);
	}

	/**
	 * Whether Meta still offers the template, approved, parameterless, in
	 * this language and with a static button opening the feed's page.
	 *
	 * @param array[] $templates    {@see Client::templates()} list.
	 * @param array   $template     Saved template choice.
	 * @param string  $expected_url The feed's weekly-summary link.
	 * @return bool
	 */
	public static function offered( array $templates, array $template, $expected_url ) {
		foreach ( $templates as $candidate ) {
			if ( $candidate['name'] !== $template['name'] || $candidate['language'] !== $template['language'] ) {
				continue;
			}
			foreach ( (array) ( $candidate['button_urls'] ?? array() ) as $url ) {
				if ( SharingReminders::same_url( $url, $expected_url ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * An event feed.
	 *
	 * @param int $source_id Event feed ID.
	 * @return array|false|null The feed, false when Fair Events cannot be
	 *     read, or null when the feed does not exist.
	 */
	public static function source( $source_id ) {
		if ( ! class_exists( '\FairEvents\Database\EventSourceRepository' ) ) {
			return false;
		}
		$source = ( new \FairEvents\Database\EventSourceRepository() )->get_by_id( absint( $source_id ) );
		return $source ? $source : null;
	}

	/**
	 * A skipped run.
	 *
	 * @param string $reason Skip reason.
	 * @param array  $fields Other run fields.
	 * @return array
	 */
	private static function skip( $reason, array $fields = array() ) {
		return array_merge(
			$fields,
			array(
				'state'  => ReminderRuns::SKIPPED,
				'reason' => $reason,
			)
		);
	}

	/**
	 * A run that failed before anything was sent.
	 *
	 * @param string $reason Failure reason.
	 * @param array  $fields Other run fields.
	 * @return array
	 */
	private static function fail( $reason, array $fields = array() ) {
		return array_merge(
			$fields,
			array(
				'state'  => ReminderRuns::FAILED,
				'reason' => $reason,
			)
		);
	}

	/**
	 * What {@see self::run()} returns.
	 *
	 * @param string $state  State.
	 * @param string $reason Reason.
	 * @param int    $run_id Run ID.
	 * @return array
	 */
	private static function result( $state, $reason = '', $run_id = 0 ) {
		return array(
			'state'  => $state,
			'reason' => $reason,
			'run_id' => (int) $run_id,
		);
	}
}
