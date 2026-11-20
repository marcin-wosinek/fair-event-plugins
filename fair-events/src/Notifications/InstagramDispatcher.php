<?php
/**
 * Scheduled Instagram event-list posts.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Core\Cron;

defined( 'WPINC' ) || die;

/**
 * Schedules each Instagram configuration's weekly post and publishes it in
 * bounded background steps.
 *
 * Scheduling follows {@see TelegramDispatcher}: one WP-Cron event per send,
 * carrying the week it covers, fixed when it was scheduled, and the
 * configuration ID.
 *
 * Publishing an Instagram post takes several requests: Instagram downloads
 * the image and processes it before it can be published. Each configuration
 * and week therefore has one publishing job, saved before every call to
 * Instagram:
 *
 * 1. The send claims the week in {@see DeliveryLog} (one claim per
 *    configuration, week and account), so repeated or overlapping runs never
 *    prepare a second post. It renders the post once and saves the job with
 *    the account, the caption and the stored image: what is published is
 *    this snapshot, never a later rendering.
 * 2. It asks Instagram for a media container. Nothing is public yet.
 * 3. Background steps ({@see self::JOB_HOOK}) poll the container until it is
 *    processed, a bounded number of times.
 * 4. Before publishing, a step checks again that the notification exists
 *    and is on and that the connected account is the one in the job. It
 *    saves the intent to publish, then publishes.
 * 5. When the answer to publishing is unclear, or a step stopped after
 *    saving the intent, later steps read the container's status: published,
 *    not published, or still unknown after a bounded number of checks. A
 *    replacement post is never created, and the container is never
 *    published a second time.
 *
 * The outcome goes to the delivery record, the notification history (with
 * the post's link) and the run list, and the stored image is removed. A
 * safety-net step is always queued before calling Instagram, so a request
 * that stops midway is picked up.
 */
class InstagramDispatcher {
	public const HOOK     = 'fair_events_notification_instagram';
	public const JOB_HOOK = 'fair_events_notification_instagram_step';
	public const PROVIDER = 'instagram';

	/**
	 * Unfinished jobs, as `config_id|week_start` keys.
	 */
	public const JOBS_OPTION = 'fair_events_notification_instagram_jobs';

	public const PHASE_CREATING   = 'creating';
	public const PHASE_PROCESSING = 'processing';
	public const PHASE_PUBLISHING = 'publishing';
	public const PHASE_UNCERTAIN  = 'uncertain';

	public const POLL_INTERVAL    = 30;
	public const MAX_POLLS        = 20;
	public const CHECK_INTERVAL   = 120;
	public const MAX_CHECKS       = 6;
	public const CREATE_GRACE     = 180;
	private const RUN_HISTORY_MAX = 10;

	/**
	 * Delivery record.
	 *
	 * @var DeliveryLog
	 */
	private $log;

	/**
	 * Fair Events Experimental's posting.
	 *
	 * @var InstagramAdapter
	 */
	private $adapter;

	/**
	 * Summary builder.
	 *
	 * @var SummaryBuilder
	 */
	private $builder;

	/**
	 * Execution history.
	 *
	 * @var ExecutionHistory
	 */
	private $history;

	/**
	 * Constructor.
	 *
	 * @param DeliveryLog|null      $log     Delivery record.
	 * @param InstagramAdapter|null $adapter Instagram posting.
	 * @param SummaryBuilder|null   $builder Summary builder.
	 * @param ExecutionHistory|null $history Execution history.
	 */
	public function __construct( $log = null, $adapter = null, $builder = null, $history = null ) {
		$this->log     = $log ? $log : new DeliveryLog();
		$this->adapter = $adapter ? $adapter : new InstagramAdapter();
		$this->builder = $builder ? $builder : new SummaryBuilder();
		$this->history = $history ? $history : new ExecutionHistory();
	}

	/**
	 * Register the workers, keep each configuration's next send scheduled and
	 * every unfinished job moving.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ), 10, 2 );
		add_action( self::JOB_HOOK, array( self::class, 'handle_step' ), 10, 2 );

		foreach ( Configurations::all( Configurations::INSTAGRAM ) as $configuration ) {
			$settings = InstagramSettings::get( $configuration['id'] );
			if ( $settings['enabled'] && ! self::next_run( $configuration['id'] ) ) {
				// Always the next future moment: a missed send is never replayed.
				self::schedule_next( $configuration['id'], $settings, self::now() );
				ScheduledSends::drop_if_deleted( self::HOOK, $configuration['id'], Configurations::INSTAGRAM );
			}
		}

		// E.g. after the plugin was deactivated while a post was processing.
		foreach ( self::unfinished() as list( $config_id, $week_start ) ) {
			Cron::ensure_single( time() + self::POLL_INTERVAL, self::JOB_HOOK, array( $config_id, $week_start ) );
		}
	}

	/**
	 * Remove one configuration's scheduled sends. A post being published
	 * finishes; it checks the configuration before it becomes public.
	 *
	 * @param string $config_id Configuration ID.
	 * @return void
	 */
	public static function unschedule( $config_id ) {
		ScheduledSends::clear( self::HOOK, $config_id );
		delete_option( Configurations::option( $config_id, 'next_run' ) );
	}

	/**
	 * Remove every scheduled send and step, e.g. when the plugin is deactivated.
	 *
	 * Unfinished jobs stay saved and continue from {@see self::init()}.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::HOOK );
		wp_unschedule_hook( self::JOB_HOOK );
		foreach ( Configurations::all( Configurations::INSTAGRAM ) as $configuration ) {
			delete_option( Configurations::option( $configuration['id'], 'next_run' ) );
		}
	}

	/**
	 * Cron callback of a scheduled send.
	 *
	 * @param string $week_start First day of the covered week, fixed at scheduling time.
	 * @param string $config_id  Configuration ID.
	 * @return void
	 */
	public static function handle( $week_start, $config_id = '' ) {
		$config_id = (string) $config_id;
		if ( ! Configurations::exists( $config_id, Configurations::INSTAGRAM ) ) {
			return;
		}
		$settings = InstagramSettings::get( $config_id );
		$now      = self::now();

		// The following send first, so a failure below never stops the cycle.
		if ( $settings['enabled'] ) {
			self::schedule_next( $config_id, $settings, $now );
		}
		if ( ScheduledSends::drop_if_deleted( self::HOOK, $config_id, Configurations::INSTAGRAM ) ) {
			return;
		}

		$dispatcher = new self();
		$dispatcher->process( $config_id, (string) $week_start, $settings, $now );
		$dispatcher->log->cleanup();
	}

	/**
	 * Cron callback of a publishing step.
	 *
	 * @param string $config_id  Configuration ID.
	 * @param string $week_start First day of the covered week.
	 * @return void
	 */
	public static function handle_step( $config_id, $week_start ) {
		( new self() )->step( (string) $config_id, (string) $week_start );
	}

	/**
	 * Replace one configuration's scheduled send after its settings change.
	 *
	 * @param string $config_id Configuration ID.
	 * @param array  $settings  Its settings.
	 * @return void
	 */
	public static function reschedule( $config_id, array $settings ) {
		$next = self::next_run( $config_id );
		if ( $settings['enabled'] && $next && $next['timestamp'] <= time() ) {
			// A due send is waiting for WP-Cron; it schedules the following one.
			return;
		}

		self::unschedule( $config_id );
		if ( $settings['enabled'] ) {
			self::schedule_next( $config_id, $settings, self::now() );
		}
	}

	/**
	 * A configuration's scheduled send, if its cron event still exists.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array{timestamp: int, week_start: string}|null
	 */
	public static function next_run( $config_id ) {
		$next = get_option( Configurations::option( $config_id, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['week_start'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['week_start'], $config_id ) );

		return $timestamp
			? array(
				'timestamp'  => (int) $timestamp,
				'week_start' => (string) $next['week_start'],
			)
			: null;
	}

	/**
	 * Schedule a configuration's first send after a moment.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param array              $settings  Its settings.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @return bool Whether the send is scheduled.
	 */
	private static function schedule_next( $config_id, array $settings, \DateTimeImmutable $after ) {
		$due  = WeekSchedule::next_due( $after, $settings['day_of_week'], $settings['time_of_day'] );
		$week = WeekSchedule::target_week( $due, $settings['week_scope'], TelegramDispatcher::start_of_week() );

		if ( true !== Cron::ensure_single( $due->getTimestamp(), self::HOOK, array( $week['start'], $config_id ) ) ) {
			delete_option( Configurations::option( $config_id, 'next_run' ) );
			return false;
		}
		update_option(
			Configurations::option( $config_id, 'next_run' ),
			array(
				'timestamp'  => $due->getTimestamp(),
				'week_start' => $week['start'],
			),
			false
		);
		return true;
	}

	/**
	 * Prepare one configuration's post for a week and start publishing it.
	 *
	 * @param string             $config_id  Configuration ID.
	 * @param string             $week_start First day of the covered week.
	 * @param array              $settings   Its settings.
	 * @param \DateTimeImmutable $now        Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $config_id, $week_start, array $settings, \DateTimeImmutable $now ) {
		$week = WeekSchedule::week_from_start( $week_start );
		if ( ! $week || ! $settings['enabled'] ) {
			return null;
		}
		$recorder = HistoryRecorder::scheduled( $this->history, $config_id, Configurations::INSTAGRAM, $week['start'], $week );

		if ( WeekSchedule::has_ended( $week, $now ) ) {
			$recorder->finish( HistoryOutcome::SKIPPED, 'expired' );
			return $this->record( $config_id, $week, 'expired', __( 'Not posted: the week had already ended when the scheduled post ran.', 'fair-events' ) );
		}

		$posts = $this->adapter->posts();
		if ( ! $posts ) {
			$recorder->finish( HistoryOutcome::FAILURE, 'instagram_unavailable' );
			return $this->record( $config_id, $week, 'configuration_error', $this->adapter->message( $this->adapter->availability() ) );
		}

		$account = $posts->account();
		if ( empty( $account['usable'] ) || '' === (string) $account['user_id'] ) {
			$recorder->finish( HistoryOutcome::FAILURE, 'instagram_not_connected' );
			return $this->record( $config_id, $week, 'configuration_error', '' !== (string) $account['message'] ? $account['message'] : __( 'Instagram is not connected. Connect an account in Fair Events → Instagram.', 'fair-events' ) );
		}

		$summary = $this->builder->build( $settings, $week );
		if ( is_wp_error( $summary ) ) {
			$recorder->finish( HistoryOutcome::FAILURE, 'configuration_error' );
			return $this->record( $config_id, $week, 'configuration_error', $summary->get_error_message() );
		}
		if ( 0 === $summary['occurrence_count'] ) {
			$recorder->finish( HistoryOutcome::SKIPPED, 'no_events' );
			return $this->record( $config_id, $week, 'skipped_empty', __( 'No events this week, so nothing was posted.', 'fair-events' ) );
		}

		$post = $posts->compose( $summary );
		if ( is_wp_error( $post ) ) {
			$recorder->finish( HistoryOutcome::FAILURE, self::code( $post->get_error_code(), 'instagram_render_failed' ) );
			return $this->record( $config_id, $week, 'configuration_error', $post->get_error_message() );
		}

		$account_id = (string) $account['user_id'];
		if ( ! $this->log->claim( $config_id, $week['start'], self::PROVIDER, $account_id, 1, 1 ) ) {
			// An overlapping run prepared this week's post; its record stands.
			$recorder->finish( HistoryOutcome::SKIPPED, 'already_claimed' );
			return null;
		}
		$recorder->claimed();

		$job = array(
			'config_id'    => $config_id,
			'week_start'   => $week['start'],
			'week_end'     => $week['end'],
			'account_id'   => $account_id,
			'username'     => (string) $account['username'],
			'caption'      => $post['caption'],
			'image_path'   => '',
			'container_id' => '',
			'phase'        => self::PHASE_CREATING,
			'polls'        => 0,
			'checks'       => 0,
			'execution_id' => $recorder->id(),
			'delivery_id'  => $recorder->attempt( self::account_label( $account_id, (string) $account['username'] ) ),
			'started_at'   => time(),
			'updated_at'   => time(),
		);

		if ( ! $this->lock( $job ) ) {
			// Unreachable in practice: only the claim's winner gets here.
			return $this->finalize( $job, 'failed', 'internal_error', __( 'The post could not be prepared. Nothing was published.', 'fair-events' ) );
		}
		try {
			$asset = $posts->store_image( $post['jpeg'] );
			if ( is_wp_error( $asset ) ) {
				return $this->finalize( $job, 'failed', self::code( $asset->get_error_code(), 'instagram_asset_failed' ), $asset->get_error_message() );
			}
			$job['image_path'] = (string) $asset['path'];
			$this->save_job( $job );
			// Queued before Instagram is contacted, so a stopped request is picked up.
			$this->schedule_step( $job, self::POLL_INTERVAL );

			$created = $posts->create_container( $asset['url'], $post['caption'] );
			if ( 'ok' !== $created['state'] ) {
				return $this->finalize( $job, 'failed', 'instagram_container_failed', self::detail( __( 'Instagram did not accept the image and caption. Nothing was published.', 'fair-events' ), $created['message'] ) );
			}

			$job['container_id'] = (string) $created['id'];
			$job['phase']        = self::PHASE_PROCESSING;
			$this->save_job( $job );

			return $this->record( $config_id, $week, 'processing', __( 'Prepared. Instagram is processing the image; the post is published once it is ready.', 'fair-events' ) );
		} catch ( \Throwable $e ) {
			// Nothing is published before the job reaches its publishing phase.
			return $this->finalize( $job, 'failed', 'internal_error', __( 'An error on this site stopped the post before it was published. Nothing was published.', 'fair-events' ) );
		} finally {
			$this->unlock( $job );
		}
	}

	/**
	 * Move one unfinished job forward.
	 *
	 * @param string $config_id  Configuration ID.
	 * @param string $week_start First day of the covered week.
	 * @return array|null The run record once the job finished, otherwise null.
	 */
	public function step( $config_id, $week_start ) {
		$job = $this->job( $config_id, $week_start );
		if ( ! $job ) {
			return null;
		}
		if ( ! $this->lock( $job ) ) {
			// Another request is working on it; look again shortly.
			$this->schedule_step( $job, self::POLL_INTERVAL );
			return null;
		}

		try {
			$job = $this->job( $config_id, $week_start );
			if ( ! $job ) {
				return null;
			}
			$this->history->renew( $job['execution_id'] );

			switch ( $job['phase'] ) {
				case self::PHASE_CREATING:
					if ( time() - (int) $job['updated_at'] < self::CREATE_GRACE ) {
						$this->schedule_step( $job, self::POLL_INTERVAL );
						return null;
					}
					return $this->finalize( $job, 'failed', 'interrupted', __( 'Preparing the post stopped before Instagram answered. Nothing was published, and this week’s post is not retried automatically.', 'fair-events' ) );
				case self::PHASE_PROCESSING:
					return $this->poll( $job );
				default:
					return $this->check( $job );
			}
		} catch ( \Throwable $e ) {
			// Whatever the phase, the next step reads the job again; a job
			// that may have published is only ever checked, never republished.
			$this->schedule_step( $job, self::CHECK_INTERVAL );
			return null;
		} finally {
			$this->unlock( $job );
		}
	}

	/**
	 * Wait for Instagram to process the container, then publish it.
	 *
	 * @param array $job Job.
	 * @return array|null
	 */
	private function poll( array $job ) {
		$posts = $this->adapter->posts();
		if ( ! $posts ) {
			return $this->finalize( $job, 'failed', 'instagram_unavailable', self::detail( __( 'Not published: Instagram posting became unavailable while the image was processed.', 'fair-events' ), $this->adapter->message( $this->adapter->availability() ) ) );
		}

		$status = $posts->container_status( $job['container_id'] );
		$code   = 'ok' === $status['state'] ? $status['status_code'] : '';

		if ( 'FINISHED' === $code ) {
			return $this->publish( $job, $posts );
		}
		if ( 'PUBLISHED' === $code ) {
			return $this->finalize( $job, 'sent', '', '' );
		}
		if ( 'ERROR' === $code || 'EXPIRED' === $code || 'failed' === $status['state'] ) {
			return $this->finalize( $job, 'failed', 'instagram_processing_failed', self::detail( __( 'Instagram could not process the image. Nothing was published.', 'fair-events' ), $status['message'] ) );
		}

		++$job['polls'];
		if ( $job['polls'] >= self::MAX_POLLS ) {
			return $this->finalize( $job, 'failed', 'instagram_processing_timeout', __( 'Instagram did not finish processing the image in time. Nothing was published, and this week’s post is not retried automatically.', 'fair-events' ) );
		}
		$this->save_job( $job );
		$this->schedule_step( $job, self::POLL_INTERVAL );
		return null;
	}

	/**
	 * Publish a processed container, once.
	 *
	 * @param array  $job   Job.
	 * @param object $posts Instagram posting.
	 * @return array|null
	 */
	private function publish( array $job, $posts ) {
		$blocked = $this->publish_blocker( $job, $posts );
		if ( $blocked ) {
			return $this->finalize( $job, 'failed', $blocked['code'], $blocked['message'] );
		}

		// The intent is saved, and a check queued, before Instagram is asked:
		// from here on the job is only ever checked, never published again.
		$job['phase'] = self::PHASE_PUBLISHING;
		$this->save_job( $job );
		$this->schedule_step( $job, self::CHECK_INTERVAL );

		$result = $posts->publish( $job['container_id'] );
		if ( 'sent' === $result['state'] ) {
			return $this->finalize( $job, 'sent', '', '', $posts->permalink( $result['id'] ) );
		}
		if ( 'failed' === $result['state'] ) {
			return $this->finalize( $job, 'failed', 'instagram_publish_failed', self::detail( __( 'Instagram refused to publish the post. Nothing was published.', 'fair-events' ), $result['message'] ) );
		}

		$job['phase'] = self::PHASE_UNCERTAIN;
		$this->save_job( $job );
		$this->record(
			$job['config_id'],
			self::week_of( $job ),
			'uncertain',
			__( 'Instagram did not confirm the post. This site checks whether it was published; it is never posted a second time.', 'fair-events' )
		);
		return null;
	}

	/**
	 * Find out whether a container whose publishing was not confirmed was published.
	 *
	 * @param array $job Job.
	 * @return array|null
	 */
	private function check( array $job ) {
		++$job['checks'];
		$posts  = $this->adapter->posts();
		$status = $posts ? $posts->container_status( $job['container_id'] ) : array( 'state' => 'uncertain' );
		$code   = 'ok' === $status['state'] ? $status['status_code'] : '';

		if ( 'PUBLISHED' === $code ) {
			return $this->finalize( $job, 'sent', '', '' );
		}
		// A container that was never published. Instagram is given a second
		// check to report it as published before that is concluded.
		if ( 'EXPIRED' === $code || 'ERROR' === $code || ( 'FINISHED' === $code && $job['checks'] >= 2 ) ) {
			return $this->finalize( $job, 'failed', 'instagram_not_published', __( 'Instagram reports that the post was not published. It is not retried automatically.', 'fair-events' ) );
		}

		if ( $job['checks'] >= self::MAX_CHECKS ) {
			return $this->finalize( $job, 'uncertain', 'instagram_publish_uncertain', __( 'It is not known whether the post was published: Instagram did not confirm it. Check the Instagram account. It is never posted a second time automatically.', 'fair-events' ) );
		}
		$this->save_job( $job );
		$this->schedule_step( $job, self::CHECK_INTERVAL );
		return null;
	}

	/**
	 * Why a processed post must not be published now, if it must not.
	 *
	 * @param array  $job   Job.
	 * @param object $posts Instagram posting.
	 * @return array{code: string, message: string}|null
	 */
	private function publish_blocker( array $job, $posts ) {
		if ( ! Configurations::still_exists( $job['config_id'], Configurations::INSTAGRAM ) ) {
			return array(
				'code'    => 'instagram_notification_deleted',
				'message' => __( 'Not published: the notification was deleted before the post was ready.', 'fair-events' ),
			);
		}
		if ( ! InstagramSettings::get( $job['config_id'] )['enabled'] ) {
			return array(
				'code'    => 'instagram_turned_off',
				'message' => __( 'Not published: the notification was turned off before the post was ready. This week’s post is not retried automatically.', 'fair-events' ),
			);
		}
		$account = $posts->account();
		if ( empty( $account['usable'] ) ) {
			return array(
				'code'    => 'instagram_not_connected',
				'message' => self::detail( __( 'Not published: the Instagram connection cannot be used.', 'fair-events' ), (string) $account['message'] ),
			);
		}
		if ( (string) $account['user_id'] !== $job['account_id'] ) {
			return array(
				'code'    => 'instagram_account_changed',
				'message' => __( 'Not published: a different Instagram account was connected after the post was prepared for the previous one. This week’s post is not retried automatically.', 'fair-events' ),
			);
		}
		return null;
	}

	/**
	 * Record a job's outcome everywhere and remove what it left behind.
	 *
	 * @param array  $job       Job.
	 * @param string $state     'sent', 'failed' or 'uncertain'.
	 * @param string $code      Safe reason code.
	 * @param string $message   Administrator-facing detail.
	 * @param string $permalink Published post's link, when known.
	 * @return array The run record.
	 */
	private function finalize( array $job, $state, $code, $message, $permalink = '' ) {
		$this->log->finish(
			$job['config_id'],
			$job['week_start'],
			self::PROVIDER,
			$job['account_id'],
			1,
			array(
				'state'   => $state,
				'code'    => $code,
				'message' => $message,
			)
		);
		$this->history->settle( $job['execution_id'], $job['delivery_id'], HistoryOutcome::from_state( $state ), $code );
		if ( '' !== $permalink ) {
			$this->history->name_delivery( $job['execution_id'], $job['delivery_id'], $permalink );
		}
		$this->history->conclude( $job['execution_id'] );

		self::delete_image( $job['image_path'] );
		$this->delete_job( $job );
		wp_clear_scheduled_hook( self::JOB_HOOK, array( $job['config_id'], $job['week_start'] ) );

		if ( 'sent' === $state ) {
			$message = '' !== $permalink
				? __( 'Published on Instagram.', 'fair-events' )
				: __( 'Published on Instagram. Its link could not be read.', 'fair-events' );
		}
		return $this->record( $job['config_id'], self::week_of( $job ), 'sent' === $state ? 'sent' : $state, $message, $permalink );
	}

	/**
	 * A configuration's unfinished job for a week.
	 *
	 * @param string $config_id  Configuration ID.
	 * @param string $week_start First day of the week.
	 * @return array|null
	 */
	public function job( $config_id, $week_start ) {
		$option = self::job_option( $config_id, $week_start );
		wp_cache_delete( $option, 'options' );
		$job = get_option( $option, null );
		return is_array( $job ) && ! empty( $job['phase'] ) ? $job : null;
	}

	/**
	 * A configuration's unfinished jobs, oldest first.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array[]
	 */
	public static function jobs( $config_id ) {
		$jobs = array();
		foreach ( self::unfinished() as list( $id, $week_start ) ) {
			if ( $id === $config_id ) {
				$job = get_option( self::job_option( $id, $week_start ), null );
				if ( is_array( $job ) ) {
					$jobs[] = $job;
				}
			}
		}
		return $jobs;
	}

	/**
	 * Save a job and list it as unfinished.
	 *
	 * @param array $job Job.
	 * @return void
	 */
	private function save_job( array $job ) {
		$job['updated_at'] = time();
		update_option( self::job_option( $job['config_id'], $job['week_start'] ), $job, false );

		$key  = $job['config_id'] . '|' . $job['week_start'];
		$list = self::job_keys();
		if ( ! in_array( $key, $list, true ) ) {
			$list[] = $key;
			update_option( self::JOBS_OPTION, $list, false );
		}
	}

	/**
	 * Remove a finished job.
	 *
	 * @param array $job Job.
	 * @return void
	 */
	private function delete_job( array $job ) {
		delete_option( self::job_option( $job['config_id'], $job['week_start'] ) );
		$key  = $job['config_id'] . '|' . $job['week_start'];
		$list = self::job_keys();
		if ( in_array( $key, $list, true ) ) {
			update_option( self::JOBS_OPTION, array_values( array_diff( $list, array( $key ) ) ), false );
		}
	}

	/**
	 * Listed unfinished jobs.
	 *
	 * @return string[]
	 */
	private static function job_keys() {
		wp_cache_delete( self::JOBS_OPTION, 'options' );
		$list = get_option( self::JOBS_OPTION, array() );
		return is_array( $list ) ? array_values( array_filter( $list, 'is_string' ) ) : array();
	}

	/**
	 * Unfinished jobs as configuration ID and week.
	 *
	 * @return array[]
	 */
	private static function unfinished() {
		$jobs = array();
		foreach ( self::job_keys() as $key ) {
			$parts = explode( '|', $key );
			if ( 2 === count( $parts ) && Configurations::valid_id( $parts[0] ) && WeekSchedule::week_from_start( $parts[1] ) ) {
				$jobs[] = $parts;
			}
		}
		return $jobs;
	}

	/**
	 * Option holding a job.
	 *
	 * @param string $config_id  Configuration ID.
	 * @param string $week_start First day of the week.
	 * @return string
	 */
	private static function job_option( $config_id, $week_start ) {
		return Configurations::option( $config_id, 'instagram_job_' . $week_start );
	}

	/**
	 * Queue a job's next step.
	 *
	 * @param array $job   Job.
	 * @param int   $delay Seconds from now.
	 * @return void
	 */
	protected function schedule_step( array $job, $delay ) {
		$args = array( $job['config_id'], $job['week_start'] );
		wp_clear_scheduled_hook( self::JOB_HOOK, $args );
		Cron::ensure_single( time() + $delay, self::JOB_HOOK, $args );
	}

	/**
	 * Take a job's lock, so two requests never move it at once.
	 *
	 * @param array $job Job.
	 * @return bool
	 */
	protected function lock( array $job ) {
		return Lock::acquire( self::lock_name( $job ), 0 );
	}

	/**
	 * Release a job's lock.
	 *
	 * @param array $job Job.
	 * @return void
	 */
	protected function unlock( array $job ) {
		Lock::release( self::lock_name( $job ) );
	}

	/**
	 * A job's lock name, within MySQL's limit once {@see Lock} adds its suffix.
	 *
	 * @param array $job Job.
	 * @return string
	 */
	private static function lock_name( array $job ) {
		return 'fair_events_ig_' . substr( md5( $job['config_id'] . '|' . $job['week_start'] ), 0, 16 );
	}

	/**
	 * Remove a stored post image. Only images Fair Events Experimental stored
	 * for Instagram, by their random name, are removed.
	 *
	 * @param string $path Image path.
	 * @return void
	 */
	private static function delete_image( $path ) {
		$path = (string) $path;
		if ( preg_match( '#/fair-events-instagram/[a-z0-9]{32}\.jpg$#', $path ) && file_exists( $path ) ) {
			wp_delete_file( $path );
		}
	}

	/**
	 * A job's week.
	 *
	 * @param array $job Job.
	 * @return array{start: string, end: string}
	 */
	private static function week_of( array $job ) {
		return array(
			'start' => $job['week_start'],
			'end'   => $job['week_end'],
		);
	}

	/**
	 * How the account is shown in the history.
	 *
	 * @param string $account_id Account ID.
	 * @param string $username   Username, when known.
	 * @return string
	 */
	public static function account_label( $account_id, $username ) {
		return '' !== $username ? '@' . $username : $account_id;
	}

	/**
	 * A safe reason code.
	 *
	 * @param string $code     Error code.
	 * @param string $fallback Code when it is empty.
	 * @return string
	 */
	private static function code( $code, $fallback ) {
		$code = substr( sanitize_key( (string) $code ), 0, 40 );
		return '' !== $code ? $code : $fallback;
	}

	/**
	 * A message followed by what Instagram said, when it said something.
	 *
	 * @param string $message Message.
	 * @param string $detail  Instagram's or the integration's detail.
	 * @return string
	 */
	private static function detail( $message, $detail ) {
		$detail = trim( (string) $detail );
		return '' === $detail ? $message : $message . ' ' . $detail;
	}

	/**
	 * Store the outcome of a run, one entry per covered week.
	 *
	 * @param string $config_id Configuration ID.
	 * @param array  $week      Week boundaries.
	 * @param string $status    Run status.
	 * @param string $message   Human-readable detail.
	 * @param string $permalink Published post's link.
	 * @return array The run record.
	 */
	private function record( $config_id, array $week, $status, $message, $permalink = '' ) {
		$run = array(
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'status'     => $status,
			'message'    => $message,
			'permalink'  => $permalink,
			'time'       => current_time( 'mysql', true ),
		);

		$option = Configurations::option( $config_id, 'runs' );
		$runs   = get_option( $option, array() );
		$runs   = is_array( $runs ) ? $runs : array();
		unset( $runs[ $week['start'] ] );
		$runs = array( $week['start'] => $run ) + $runs;
		update_option( $option, array_slice( $runs, 0, self::RUN_HISTORY_MAX, true ), false );

		return $run;
	}

	/**
	 * A configuration's recorded runs, newest first.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array[]
	 */
	public static function runs( $config_id ) {
		$runs = get_option( Configurations::option( $config_id, 'runs' ), array() );
		return is_array( $runs ) ? array_values( $runs ) : array();
	}

	/**
	 * The current moment in the site timezone.
	 *
	 * @return \DateTimeImmutable
	 */
	public static function now() {
		return new \DateTimeImmutable( 'now', wp_timezone() );
	}
}
