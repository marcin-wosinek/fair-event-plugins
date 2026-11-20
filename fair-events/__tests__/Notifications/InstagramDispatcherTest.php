<?php
/**
 * InstagramDispatcher unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\InstagramDispatcher;
use FairEvents\Notifications\InstagramSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';
require_once __DIR__ . '/fakes/FakeExecutionHistory.php';
require_once __DIR__ . '/fakes/FakeSummaryBuilder.php';
require_once __DIR__ . '/fakes/FakeInstagramPosts.php';
require_once __DIR__ . '/fakes/FakeInstagramAdapter.php';
require_once __DIR__ . '/fakes/TestInstagramDispatcher.php';

/**
 * Scheduled Instagram posts: event selection, failures shown in the history,
 * and never publishing the same week twice. Instagram is a fake throughout.
 */
class InstagramDispatcherTest extends TestCase {

	private const WEEK = '2026-09-14';

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Execution history.
	 *
	 * @var FakeExecutionHistory
	 */
	private $history;

	/**
	 * Summary builder.
	 *
	 * @var FakeSummaryBuilder
	 */
	private $builder;

	/**
	 * Instagram.
	 *
	 * @var FakeInstagramPosts
	 */
	private $posts;

	/**
	 * Adapter.
	 *
	 * @var FakeInstagramAdapter
	 */
	private $adapter;

	/**
	 * Configuration ID.
	 *
	 * @var string
	 */
	private $id;

	/**
	 * Set up fakes and one enabled configuration.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_cron']    = array();
		$this->log                     = new FakeDeliveryLog();
		$this->history                 = new FakeExecutionHistory();
		$this->builder                 = new FakeSummaryBuilder();
		$this->builder->result         = array(
			'text'             => 'Week',
			'occurrence_count' => 1,
			'title'            => 'Calendar',
			'url'              => 'https://example.test/calendar/',
			'range'            => '14 – 20 Sep 2026',
			'events'           => array(
				array(
					'when'  => 'Mon, 18:00',
					'title' => 'Juggling',
					'url'   => 'https://example.test/juggling/',
				),
			),
		);
		$this->posts                   = new FakeInstagramPosts();
		$this->adapter                 = new FakeInstagramAdapter( $this->posts );
		$this->id                      = Configurations::create( Configurations::INSTAGRAM, 'Weekly post', $this->settings() )['id'];
	}

	/**
	 * Enabled settings.
	 *
	 * @return array
	 */
	private function settings() {
		$settings                = InstagramSettings::defaults();
		$settings['enabled']     = true;
		$settings['source_slug'] = 'local';
		$settings['page_id']     = 7;
		return $settings;
	}

	/**
	 * A dispatcher with the fakes.
	 *
	 * @return TestInstagramDispatcher
	 */
	private function dispatcher() {
		return new TestInstagramDispatcher( $this->log, $this->adapter, $this->builder, $this->history );
	}

	/**
	 * A moment in the covered week.
	 *
	 * @return \DateTimeImmutable
	 */
	private function now() {
		return new \DateTimeImmutable( '2026-09-14 09:00', wp_timezone() );
	}

	/**
	 * Run the scheduled send.
	 *
	 * @param TestInstagramDispatcher|null $dispatcher Dispatcher.
	 * @return array|null
	 */
	private function process( $dispatcher = null ) {
		return ( $dispatcher ? $dispatcher : $this->dispatcher() )->process( $this->id, self::WEEK, $this->settings(), $this->now() );
	}

	/**
	 * Run a publishing step.
	 *
	 * @param TestInstagramDispatcher|null $dispatcher Dispatcher.
	 * @return array|null
	 */
	private function step( $dispatcher = null ) {
		return ( $dispatcher ? $dispatcher : $this->dispatcher() )->step( $this->id, self::WEEK );
	}

	/**
	 * The week's delivery record.
	 *
	 * @return array|null
	 */
	private function claim() {
		return $this->log->rows[ $this->id . '|' . self::WEEK . '|instagram|17841400000000001|1' ] ?? null;
	}

	/**
	 * The only delivery in the history.
	 *
	 * @return array
	 */
	private function delivery() {
		$this->assertCount( 1, $this->history->deliveries );
		return reset( $this->history->deliveries );
	}

	/** Publishes once the image is processed. */
	public function test_publishes_once_the_image_is_processed() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'IN_PROGRESS',
			),
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);

		$run = $this->process();
		$this->assertSame( 'processing', $run['status'] );
		$this->assertSame( InstagramDispatcher::PHASE_PROCESSING, $this->dispatcher()->job( $this->id, self::WEEK )['phase'] );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );

		$this->assertNull( $this->step() );
		$run = $this->step();

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 'https://www.instagram.com/p/ABC123/', $run['permalink'] );
		$this->assertSame( 1, $this->posts->count( 'publish' ) );
		$this->assertSame( 'sent', $this->claim()['state'] );
		$this->assertSame( HistoryOutcome::ACCEPTED, $this->delivery()['outcome'] );
		$this->assertSame( '@fair_demo', $this->delivery()['recipient'] );
		$this->assertSame( 'https://www.instagram.com/p/ABC123/', $this->delivery()['recipient_name'] );
		$this->assertSame( HistoryOutcome::SUCCESS, $this->history->only()['outcome'] );
		$this->assertNull( $this->dispatcher()->job( $this->id, self::WEEK ) );
		$this->assertSame( array(), InstagramDispatcher::jobs( $this->id ) );
	}

	/** A repeated send never prepares a second post. */
	public function test_a_repeated_send_never_prepares_a_second_post() {
		$this->process();
		$this->assertNull( $this->process() );

		$this->assertSame( 1, $this->posts->count( 'create_container' ) );
		$this->assertSame( 1, $this->posts->count( 'store_image' ) );
	}

	/** Skips weeks without events. */
	public function test_skips_weeks_without_events() {
		$this->builder->result['occurrence_count'] = 0;
		$this->builder->result['events']           = array();

		$run = $this->process();

		$this->assertSame( 'skipped_empty', $run['status'] );
		$this->assertSame( array(), $this->posts->calls );
		$this->assertNull( $this->claim() );
		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SKIPPED, $execution['outcome'] );
		$this->assertSame( 'no_events', $execution['reason_code'] );
	}

	/** Covers the scheduled week. */
	public function test_covers_the_scheduled_week() {
		$this->process();

		$this->assertSame(
			array(
				array(
					'start' => '2026-09-14',
					'end'   => '2026-09-20',
				),
			),
			$this->builder->weeks
		);
	}

	/** Reports unavailable experimental functionality. */
	public function test_reports_unavailable_experimental_functionality() {
		$this->adapter->posts = null;

		$run = $this->process();

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( 'Turn on Instagram.', $run['message'] );
		$this->assertSame( 'instagram_unavailable', $this->history->only()['reason_code'] );
		$this->assertSame( HistoryOutcome::FAILURE, $this->history->only()['outcome'] );
		$this->assertSame( array(), $this->builder->weeks );
	}

	/** Reports a missing connection. */
	public function test_reports_a_missing_connection() {
		$this->posts->account['usable']  = false;
		$this->posts->account['message'] = 'Instagram needs to be reconnected.';

		$run = $this->process();

		$this->assertSame( 'Instagram needs to be reconnected.', $run['message'] );
		$this->assertSame( 'instagram_not_connected', $this->history->only()['reason_code'] );
		$this->assertSame( array(), $this->posts->calls );
	}

	/** A list that does not fit publishes nothing. */
	public function test_a_list_that_does_not_fit_publishes_nothing() {
		$this->posts->post = new \WP_Error( 'instagram_list_too_long', 'Too many events.' );

		$run = $this->process();

		$this->assertSame( 'Too many events.', $run['message'] );
		$this->assertSame( 'instagram_list_too_long', $this->history->only()['reason_code'] );
		$this->assertSame( array( 'compose' ), $this->posts->calls );
		$this->assertNull( $this->claim() );
	}

	/** A refused container is a failure without a post. */
	public function test_a_refused_container_is_a_failure_without_a_post() {
		$this->posts->container = array(
			'state'   => 'failed',
			'id'      => '',
			'code'    => 'meta_100',
			'message' => 'Invalid image.',
		);

		$run = $this->process();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertStringContainsString( 'Invalid image.', $run['message'] );
		$this->assertSame( 'instagram_container_failed', $this->delivery()['reason_code'] );
		$this->assertSame( HistoryOutcome::FAILURE, $this->history->only()['outcome'] );
		$this->assertNull( $this->dispatcher()->job( $this->id, self::WEEK ) );
	}

	/** Failed processing never publishes. */
	public function test_failed_processing_never_publishes() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'ERROR',
				'message'     => 'Unsupported image.',
			),
		);
		$this->process();

		$run = $this->step();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'instagram_processing_failed', $this->delivery()['reason_code'] );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** Processing gives up after bounded polls. */
	public function test_processing_gives_up_after_bounded_polls() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'IN_PROGRESS',
			),
		);
		$this->process();

		$run = null;
		for ( $i = 0; $i < InstagramDispatcher::MAX_POLLS; $i++ ) {
			$run = $this->step();
		}

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'instagram_processing_timeout', $this->delivery()['reason_code'] );
		$this->assertSame( InstagramDispatcher::MAX_POLLS, $this->posts->count( 'container_status' ) );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** A busy job is left to the request working on it. */
	public function test_a_busy_job_is_left_to_the_request_working_on_it() {
		$this->process();
		$dispatcher            = $this->dispatcher();
		$dispatcher->lock_free = false;

		$this->assertNull( $this->step( $dispatcher ) );

		$this->assertSame( 0, $this->posts->count( 'container_status' ) );
		$this->assertSame( array( InstagramDispatcher::POLL_INTERVAL ), $dispatcher->steps );
	}

	/** A refused publication is a failure. */
	public function test_a_refused_publication_is_a_failure() {
		$this->posts->statuses  = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);
		$this->posts->published = array(
			'state'   => 'failed',
			'id'      => '',
			'code'    => 'meta_9',
			'message' => 'Rate limited.',
		);
		$this->process();

		$run = $this->step();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'instagram_publish_failed', $this->delivery()['reason_code'] );
		$this->assertSame( 'failed', $this->claim()['state'] );
	}

	/** An unconfirmed publication is checked not repeated. */
	public function test_an_unconfirmed_publication_is_checked_not_repeated() {
		$this->posts->statuses  = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
			array(
				'state'       => 'uncertain',
				'status_code' => '',
			),
			array(
				'state'       => 'ok',
				'status_code' => 'PUBLISHED',
			),
		);
		$this->posts->published = array(
			'state'   => 'uncertain',
			'id'      => '',
			'code'    => 'transport_error',
			'message' => 'Timed out.',
		);
		$this->process();

		$this->assertNull( $this->step() );
		$this->assertSame( InstagramDispatcher::PHASE_UNCERTAIN, $this->dispatcher()->job( $this->id, self::WEEK )['phase'] );
		$this->assertNull( $this->step() );
		$run = $this->step();

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 1, $this->posts->count( 'publish' ) );
		$this->assertSame( HistoryOutcome::ACCEPTED, $this->delivery()['outcome'] );
	}

	/** A container still unpublished after two checks is not published. */
	public function test_a_container_still_unpublished_after_two_checks_is_not_published() {
		$this->posts->statuses  = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);
		$this->posts->published = array(
			'state'   => 'uncertain',
			'id'      => '',
			'code'    => 'http_500',
			'message' => '',
		);
		$this->process();
		$this->step();

		$this->assertNull( $this->step() );
		$run = $this->step();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'instagram_not_published', $this->delivery()['reason_code'] );
		$this->assertSame( 1, $this->posts->count( 'publish' ) );
	}

	/** An outcome that stays unknown is recorded as unknown. */
	public function test_an_outcome_that_stays_unknown_is_recorded_as_unknown() {
		$this->posts->statuses  = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
			array(
				'state'       => 'uncertain',
				'status_code' => '',
			),
		);
		$this->posts->published = array(
			'state'   => 'uncertain',
			'id'      => '',
			'code'    => 'transport_error',
			'message' => '',
		);
		$this->process();
		$this->step();

		$run = null;
		for ( $i = 0; $i < InstagramDispatcher::MAX_CHECKS; $i++ ) {
			$run = $this->step();
		}

		$this->assertSame( 'uncertain', $run['status'] );
		$this->assertSame( 'uncertain', $this->claim()['state'] );
		$this->assertSame( HistoryOutcome::UNKNOWN, $this->delivery()['outcome'] );
		$this->assertSame( HistoryOutcome::UNKNOWN, $this->history->only()['outcome'] );
		$this->assertSame( 1, $this->posts->count( 'publish' ) );
	}

	/** A step interrupted while publishing is only checked. */
	public function test_a_step_interrupted_while_publishing_is_only_checked() {
		$this->posts->statuses   = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
			array(
				'state'       => 'ok',
				'status_code' => 'PUBLISHED',
			),
		);
		$this->posts->on_publish = static function () {
			throw new \RuntimeException( 'The request stopped.' );
		};
		$this->process();

		$this->assertNull( $this->step() );
		$this->assertSame( InstagramDispatcher::PHASE_PUBLISHING, $this->dispatcher()->job( $this->id, self::WEEK )['phase'] );

		$this->posts->on_publish = null;
		$run                     = $this->step();

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 1, $this->posts->count( 'publish' ) );
	}

	/** An account change stops publication. */
	public function test_an_account_change_stops_publication() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);
		$this->process();
		$this->posts->account['user_id'] = '17841400000000002';

		$run = $this->step();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'instagram_account_changed', $this->delivery()['reason_code'] );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** Turning the notification off stops publication. */
	public function test_turning_the_notification_off_stops_publication() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);
		$this->process();
		$settings            = $this->settings();
		$settings['enabled'] = false;
		InstagramSettings::save( $this->id, $settings );

		$run = $this->step();

		$this->assertSame( 'instagram_turned_off', $this->delivery()['reason_code'] );
		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** Deleting the notification stops publication. */
	public function test_deleting_the_notification_stops_publication() {
		$this->posts->statuses = array(
			array(
				'state'       => 'ok',
				'status_code' => 'FINISHED',
			),
		);
		$this->process();
		Configurations::delete( $this->id );

		$this->step();

		$this->assertSame( 'instagram_notification_deleted', $this->delivery()['reason_code'] );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** An interrupted preparation is not retried. */
	public function test_an_interrupted_preparation_is_not_retried() {
		$this->posts->container = array(
			'state'   => 'ok',
			'id'      => 'container-1',
			'code'    => '',
			'message' => '',
		);
		$this->process();
		$option              = Configurations::option( $this->id, 'instagram_job_' . self::WEEK );
		$job                 = get_option( $option );
		$job['phase']        = InstagramDispatcher::PHASE_CREATING;
		$job['updated_at']   = time() - InstagramDispatcher::CREATE_GRACE - 1;
		$job['container_id'] = '';
		update_option( $option, $job );

		$run = $this->step();

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'interrupted', $this->delivery()['reason_code'] );
		$this->assertSame( 1, $this->posts->count( 'create_container' ) );
		$this->assertSame( 0, $this->posts->count( 'publish' ) );
	}

	/** An expired week is skipped. */
	public function test_an_expired_week_is_skipped() {
		$run = $this->dispatcher()->process( $this->id, '2026-09-07', $this->settings(), $this->now() );

		$this->assertSame( 'expired', $run['status'] );
		$this->assertSame( array(), $this->posts->calls );
	}

	/** Configurations keep separate jobs. */
	public function test_configurations_keep_separate_jobs() {
		$other = Configurations::create( Configurations::INSTAGRAM, 'Other', $this->settings() )['id'];
		$this->process();
		$this->dispatcher()->process( $other, self::WEEK, $this->settings(), $this->now() );

		$this->assertSame( 2, $this->posts->count( 'create_container' ) );
		$this->assertCount( 1, InstagramDispatcher::jobs( $this->id ) );
		$this->assertCount( 1, InstagramDispatcher::jobs( $other ) );
	}
}
