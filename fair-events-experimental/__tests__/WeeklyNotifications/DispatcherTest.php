<?php
/**
 * Dispatcher unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\Dispatcher;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/helpers/FakeDeliveryLog.php';
require_once dirname( __DIR__ ) . '/helpers/FakeProvider.php';
require_once dirname( __DIR__ ) . '/helpers/FakeSummaryBuilder.php';

/**
 * Tests delivery orchestration, failure isolation and duplicate prevention.
 */
class DispatcherTest extends TestCase {

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Provider.
	 *
	 * @var FakeProvider
	 */
	private $provider;

	/**
	 * Summary builder.
	 *
	 * @var FakeSummaryBuilder
	 */
	private $builder;

	/**
	 * Set up fakes.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$this->log                     = new FakeDeliveryLog();
		$this->provider                = new FakeProvider();
		$this->builder                 = new FakeSummaryBuilder();
		$this->builder->result         = array(
			'text'             => "Heading:\n* Mon, Event",
			'occurrence_count' => 1,
		);
	}

	/**
	 * A dispatcher with the fakes.
	 *
	 * @return Dispatcher
	 */
	private function dispatcher() {
		return new Dispatcher( $this->log, array( 'fake' => $this->provider ), $this->builder );
	}

	/**
	 * Enabled settings.
	 *
	 * @return array
	 */
	private function settings() {
		$settings            = WeeklyNotificationSettings::defaults();
		$settings['enabled'] = true;
		return $settings;
	}

	/**
	 * A moment during the covered week.
	 *
	 * @param string $datetime Local datetime.
	 * @return \DateTimeImmutable
	 */
	private function moment( $datetime = '2026-09-14 09:00' ) {
		return new \DateTimeImmutable( $datetime, new \DateTimeZone( 'Europe/Madrid' ) );
	}

	/** Every destination receives the same summary. */
	public function test_every_destination_receives_the_summary() {
		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame(
			array(
				array( '@one', "Heading:\n* Mon, Event" ),
				array( '@two', "Heading:\n* Mon, Event" ),
				array( '@three', "Heading:\n* Mon, Event" ),
			),
			$this->provider->sent
		);
		$this->assertSame( '2026-09-20', $this->builder->weeks[0]['end'] );
	}

	/** One failing destination does not stop the others. */
	public function test_failure_at_one_destination_does_not_stop_others() {
		$this->provider->states['@one'] = 'failed';

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'partial', $run['status'] );
		$this->assertCount( 3, $this->provider->sent );
		$this->assertSame( 'failed', $this->log->state( '@one', 1 ) );
		$this->assertSame( 'sent', $this->log->state( '@two', 1 ) );
		$this->assertSame( 1, $run['counts']['failed'] );
		$this->assertSame( 2, $run['counts']['sent'] );
	}

	/** An exception at one destination is isolated and never resent. */
	public function test_exception_at_one_destination_is_isolated() {
		$this->provider->throws_for = '@two';

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'partial', $run['status'] );
		$this->assertSame( 'uncertain', $this->log->state( '@two', 1 ) );
		$this->assertSame( 'sent', $this->log->state( '@three', 1 ) );
	}

	/** A retried or overlapping run never sends a delivered week again. */
	public function test_repeated_runs_do_not_duplicate_deliveries() {
		$this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );
		$first_record = get_option( Dispatcher::RUNS_OPTION );

		$second = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment( '2026-09-14 09:05' ) );

		$this->assertNull( $second );
		$this->assertCount( 3, $this->provider->sent );
		$this->assertSame( $first_record, get_option( Dispatcher::RUNS_OPTION ) );
	}

	/** Failed and uncertain parts are not resent automatically. */
	public function test_failed_and_uncertain_parts_are_not_retried() {
		$this->provider->states = array(
			'@one' => 'failed',
			'@two' => 'uncertain',
		);
		$this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );
		$this->provider->states = array();

		$this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment( '2026-09-14 10:00' ) );

		$this->assertCount( 3, $this->provider->sent );
		$this->assertSame( 'uncertain', $this->log->state( '@two', 1 ) );
	}

	/** Parts go out in order; after a failed part the rest are skipped, not sent. */
	public function test_parts_are_ordered_and_stop_after_a_failure() {
		$this->provider->split_on_marker = true;
		$this->provider->destinations    = array( '@one' );
		$this->builder->result['text']   = 'first|second|third';

		$this->provider->states['@one'] = 'sent';
		$this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame(
			array( array( '@one', 'first' ), array( '@one', 'second' ), array( '@one', 'third' ) ),
			$this->provider->sent
		);
	}

	/** A failure mid-sequence records the remaining parts as skipped. */
	public function test_remaining_parts_are_skipped_after_a_failed_part() {
		$provider                      = new class() extends FakeProvider {
			/**
			 * Fail the second part.
			 *
			 * @param string $destination Destination.
			 * @param string $text        Text.
			 * @return array
			 */
			public function send( $destination, $text ) {
				$this->sent[] = array( $destination, $text );
				return array(
					'state'   => 'second' === $text ? 'failed' : 'sent',
					'code'    => '',
					'message' => '',
				);
			}
		};
		$provider->split_on_marker     = true;
		$provider->destinations        = array( '@one' );
		$this->provider                = $provider;
		$this->builder->result['text'] = 'first|second|third';

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'failed', $run['status'] );
		$this->assertCount( 2, $provider->sent );
		$this->assertSame( 'sent', $this->log->state( '@one', 1 ) );
		$this->assertSame( 'failed', $this->log->state( '@one', 2 ) );
		$this->assertSame( 'skipped', $this->log->state( '@one', 3 ) );
	}

	/** An empty week is recorded as skipped and sends nothing. */
	public function test_empty_week_is_skipped() {
		$this->builder->result = array(
			'text'             => 'Heading:',
			'occurrence_count' => 0,
		);

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'skipped_empty', $run['status'] );
		$this->assertSame( array(), $this->provider->sent );
		$this->assertSame( array(), $this->log->rows );
	}

	/** A configuration problem is recorded, not sent. */
	public function test_configuration_error_is_recorded() {
		$this->builder->result = new \WP_Error( 'calendar_mismatch', 'Calendar mismatch.' );

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( 'Calendar mismatch.', $run['message'] );
		$this->assertSame( array(), $this->provider->sent );
	}

	/** A run arriving after its week ended sends nothing. */
	public function test_run_after_the_week_ended_is_expired() {
		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment( '2026-09-21 09:00' ) );

		$this->assertSame( 'expired', $run['status'] );
		$this->assertSame( array(), $this->provider->sent );
	}

	/** A run with no destinations is a configuration error. */
	public function test_no_destinations_is_a_configuration_error() {
		$this->provider->destinations = array();

		$run = $this->dispatcher()->process( '2026-09-14', $this->settings(), $this->moment() );

		$this->assertSame( 'configuration_error', $run['status'] );
	}

	/** Disabled notifications and invalid week keys do nothing. */
	public function test_disabled_or_invalid_runs_do_nothing() {
		$disabled = WeeklyNotificationSettings::defaults();

		$this->assertNull( $this->dispatcher()->process( '2026-09-14', $disabled, $this->moment() ) );
		$this->assertNull( $this->dispatcher()->process( 'not-a-date', $this->settings(), $this->moment() ) );
		$this->assertSame( array(), $this->provider->sent );
	}
}
