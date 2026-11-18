<?php
/**
 * Sales summary REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\HistoryRecorder;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\SalesSummaryDispatcher;
use FairEvents\Notifications\SalesSummaryOrganizers;
use FairEvents\Notifications\SalesSummaryPeriod;
use FairEvents\Notifications\SalesSummaryRenderer;
use FairEvents\Notifications\SalesSummaryReport;
use FairEvents\Notifications\SalesSummarySettings;
use FairEvents\Services\EmailService;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings, preview and test routes of the sales summaries (#2306), for
 * administrators only.
 *
 * Each report has its own routes under `sales-summary/{report}`: `central`,
 * `default` (the sitewide organizer) or an additional organizer's UUID.
 * Reports that need organizer resolution answer 409 while Fair Events
 * Experimental's organizer management is unavailable; their saved settings
 * are kept. Recipient addresses never leave these routes: only their count
 * and whether the fallback address would be used.
 */
class SalesSummaryController extends WP_REST_Controller {

	/**
	 * Route namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Route base.
	 *
	 * @var string
	 */
	protected $rest_base = 'sales-summary';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$report = '/' . $this->rest_base . '/(?P<report>central|default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

		register_rest_route(
			$this->namespace,
			$report,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_report' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_report' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					// Validated together in the callback, so each field's message reaches the form.
					'args'                => array(
						'frequency'      => array( 'type' => 'string' ),
						'time_of_day'    => array( 'type' => 'string' ),
						'day_of_week'    => array( 'type' => array( 'integer', 'string' ) ),
						'fallback_email' => array( 'type' => 'string' ),
					),
				),
			)
		);

		$preview_args = array(
			'frequency' => array(
				'type' => 'string',
				'enum' => array( SalesSummarySettings::DAILY, SalesSummarySettings::WEEKLY ),
			),
		);

		register_rest_route(
			$this->namespace,
			$report . '/preview',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'preview_report' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $preview_args,
			)
		);

		register_rest_route(
			$this->namespace,
			$report . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_report' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $preview_args,
			)
		);
	}

	/**
	 * Only administrators manage sales summaries.
	 *
	 * @return true|WP_Error
	 */
	public function permissions_check() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage sales summaries.', 'fair-events' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * A report's settings and status.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_report( $request ) {
		$key   = (string) $request['report'];
		$found = $this->find_report( $key, false );
		if ( is_wp_error( $found ) ) {
			return $found;
		}

		return rest_ensure_response( $this->payload( $key, $found ) );
	}

	/**
	 * Save a report's settings: the fields sent replace the saved ones.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_report( $request ) {
		$key   = (string) $request['report'];
		$found = $this->find_report( $key, true );
		if ( is_wp_error( $found ) ) {
			return $found;
		}

		$input = SalesSummarySettings::get( $key );
		foreach ( array_keys( SalesSummarySettings::defaults() ) as $field ) {
			if ( null !== $request->get_param( $field ) ) {
				$input[ $field ] = $request->get_param( $field );
			}
		}

		$validated = SalesSummarySettings::validate( $input );
		if ( $validated['errors'] ) {
			return new WP_Error(
				'rest_invalid_param',
				implode( ' ', $validated['errors'] ),
				array(
					'status' => 400,
					'params' => $validated['errors'],
				)
			);
		}

		$settings = SalesSummarySettings::save( $key, $validated['settings'] );
		SalesSummaryDispatcher::reschedule( $key, $settings );

		return rest_ensure_response( $this->payload( $key, $found ) );
	}

	/**
	 * The report as the next send would build it now.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_report( $request ) {
		$email = $this->compose( $request, false );
		if ( is_wp_error( $email ) ) {
			return $email;
		}
		unset( $email['report'] );

		return rest_ensure_response( $email );
	}

	/**
	 * Send the report to the requesting administrator only, labelled as a
	 * test. It never counts as a scheduled send and never moves the next one.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_report( $request ) {
		$key       = (string) $request['report'];
		$recipient = IndividualEmailSettings::parse_recipient( (string) wp_get_current_user()->user_email );
		if ( null === $recipient || '' === $recipient ) {
			return new WP_Error( 'missing_recipient', __( 'Your user account has no valid email address to send the test to.', 'fair-events' ), array( 'status' => 400 ) );
		}

		$email = $this->compose( $request, true );
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		$recorder = new HistoryRecorder(
			new ExecutionHistory(),
			array(
				'config_id'   => $key,
				'config_name' => $email['name'],
				'channel'     => SalesSummaryDispatcher::CHANNEL,
				'origin'      => HistoryOutcome::TEST,
				'occurrence'  => '',
				'week_start'  => $email['period']['start'],
				'week_end'    => $email['period']['end'],
			)
		);
		$delivery = $recorder->attempt( $recipient );
		try {
			$sent = ( new EmailService() )->send_notification( $recipient, $email['subject'], $email['html'] );
			$recorder->settle( $delivery, $sent ? HistoryOutcome::ACCEPTED : HistoryOutcome::FAILED, $sent ? '' : 'send_failed' );
		} catch ( \Throwable $e ) {
			// The email may have gone out before the error.
			$sent = false;
			$recorder->settle( $delivery, HistoryOutcome::UNKNOWN, 'internal_error' );
		}
		$recorder->finish();

		if ( ! $sent ) {
			return new WP_Error(
				'send_failed',
				sprintf(
					/* translators: %s: email address */
					__( 'The test email to %s could not be sent.', 'fair-events' ),
					$recipient
				),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'sent_to' => $recipient,
				'empty'   => $email['empty'],
			)
		);
	}

	/**
	 * Build a report's email for a preview or a test.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @param bool             $test    Whether it is a test email.
	 * @return array|WP_Error
	 */
	private function compose( $request, $test ) {
		$key   = (string) $request['report'];
		$found = $this->find_report( $key, true );
		if ( is_wp_error( $found ) ) {
			return $found;
		}

		$settings  = SalesSummarySettings::get( $key );
		$frequency = (string) $request->get_param( 'frequency' );
		if ( '' === $frequency ) {
			$frequency = SalesSummarySettings::DAILY === $settings['frequency'] ? SalesSummarySettings::DAILY : SalesSummarySettings::WEEKLY;
		}
		$period     = SalesSummaryPeriod::period_at( $frequency, BulkEmailDispatcher::now() );
		$dispatcher = new SalesSummaryDispatcher( null, null, null, $found );
		$report     = $dispatcher->report( $key, $frequency, $period );
		if ( null === $report ) {
			return self::paused();
		}

		$email  = SalesSummaryRenderer::compose( $report, $test );
		$target = SalesSummaryReport::recipients( $report, $settings );

		return array(
			'report'     => $report,
			'name'       => SalesSummarySettings::CENTRAL === $key ? __( 'Sales summary: all organizers', 'fair-events' ) : sprintf(
				/* translators: %s: organizer name */
				__( 'Sales summary: %s', 'fair-events' ),
				$report['organizer']['name']
			),
			'frequency'  => $frequency,
			'period'     => $period,
			'subject'    => $email['subject'],
			'html'       => wp_kses_post( $email['html'] ),
			'empty'      => $email['empty'],
			'recipients' => array(
				'count'    => count( $target['recipients'] ),
				'fallback' => $target['fallback'],
			),
		);
	}

	/**
	 * Resolve a report's organizers, refusing a report that can't be
	 * generated now.
	 *
	 * @param string $key       Report key.
	 * @param bool   $must_work Whether a paused report is refused (saving,
	 *                          previewing, testing) rather than reported.
	 * @return SalesSummaryOrganizers|WP_Error
	 */
	private function find_report( $key, $must_work ) {
		$organizers = new SalesSummaryOrganizers();
		if ( $organizers->report_available( $key ) ) {
			return $organizers;
		}

		if ( $organizers->resolution_available() ) {
			return new WP_Error( 'rest_not_found', __( 'This organizer does not exist.', 'fair-events' ), array( 'status' => 404 ) );
		}

		return $must_work ? self::paused() : $organizers;
	}

	/**
	 * Error for a report paused while organizers can't be resolved.
	 *
	 * @return WP_Error
	 */
	private static function paused() {
		return new WP_Error(
			'sales_summary_paused',
			__( 'This sales summary is paused while organizer management is off. Its settings are kept.', 'fair-events' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * A report's settings and status.
	 *
	 * @param string                 $key        Report key.
	 * @param SalesSummaryOrganizers $organizers Organizer directory.
	 * @return array
	 */
	private function payload( $key, SalesSummaryOrganizers $organizers ) {
		$available = $organizers->report_available( $key );
		$organizer = SalesSummarySettings::CENTRAL === $key
			? $organizers->find( SalesSummarySettings::DEFAULT_ORGANIZER )
			: $organizers->find( $key );
		$settings  = SalesSummarySettings::get( $key );
		// A send left queued after the report was turned off does nothing when it runs.
		$next = $available && SalesSummarySettings::is_enabled( $settings ) ? SalesSummaryDispatcher::next_run( $key ) : null;
		$runs = SalesSummaryDispatcher::runs( $key );

		return array(
			'report'                         => $key,
			'settings'                       => $settings,
			'available'                      => $available,
			'organizer_resolution_available' => $organizers->resolution_available(),
			'recipient_count'                => $organizer ? count( SalesSummaryOrganizers::recipients( $organizer['notification_emails'] ) ) : 0,
			'next_run'                       => $next
				? array(
					'time'      => gmdate( 'c', $next['timestamp'] ),
					'frequency' => $next['frequency'],
					'period'    => SalesSummaryPeriod::period( $next['frequency'], $next['occurrence'] ),
				)
				: null,
			'last_run'                       => $runs ? $runs[0] : null,
		);
	}
}
