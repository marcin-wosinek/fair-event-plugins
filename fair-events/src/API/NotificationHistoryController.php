<?php
/**
 * Notification history administrator REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryOutcome;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Read-only routes for the notification execution and delivery history.
 *
 * Executions can be listed for the whole notification system or for one
 * configuration, also one that no longer exists, filtered by configuration,
 * channel, origin (scheduled or test), outcome and start time, newest first.
 * Under `configurations/{id}` an execution or its deliveries are found only
 * when they belong to that configuration.
 *
 * Deliveries name their recipients' addresses, so every route is for
 * administrators only, like the rest of the notification administration.
 *
 * Counts count what the execution's `counts.unit` says: Telegram counts
 * message parts, email counts recipients, and Telegram records from before
 * this history counted destinations. A count that was not recorded is null.
 * "Accepted" means the mail system or the Telegram API took the message
 * over; it does not confirm that anyone received it.
 */
class NotificationHistoryController extends WP_REST_Controller {
	private const DEFAULT_PER_PAGE = 20;
	private const MAX_PER_PAGE     = 100;

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
	protected $rest_base = 'event-notifications';

	/**
	 * Execution repository.
	 *
	 * @var ExecutionHistory
	 */
	private $history;

	/**
	 * Constructor.
	 *
	 * @param ExecutionHistory|null $history Execution repository.
	 */
	public function __construct( $history = null ) {
		$this->history = $history ? $history : new ExecutionHistory();
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$executions    = '/' . $this->rest_base . '/executions';
		$configuration = '/' . $this->rest_base . '/configurations/(?P<id>[a-z0-9_-]{1,36})/executions';
		$execution     = '/(?P<execution>\d+)';

		$filters = array(
			'channel' => array(
				'type' => 'string',
				'enum' => Configurations::TYPES,
			),
			'origin'  => array(
				'type' => 'string',
				'enum' => HistoryOutcome::ORIGINS,
			),
			'outcome' => array(
				'type' => 'string',
				'enum' => HistoryOutcome::EXECUTION_OUTCOMES,
			),
			'after'   => array(
				'description' => __( 'Executions that started at or after this time; without a timezone it is UTC.', 'fair-events' ),
				'type'        => 'string',
				'format'      => 'date-time',
			),
			'before'  => array(
				'description' => __( 'Executions that started before this time; without a timezone it is UTC.', 'fair-events' ),
				'type'        => 'string',
				'format'      => 'date-time',
			),
		);

		register_rest_route(
			$this->namespace,
			$executions,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => self::pagination_args() + $filters + array(
					'configuration' => array(
						'type'    => 'string',
						'pattern' => '^[a-z0-9_-]{1,36}$',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$configuration,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => self::pagination_args() + $filters,
			)
		);

		foreach ( array( $executions, $configuration ) as $base ) {
			register_rest_route(
				$this->namespace,
				$base . $execution,
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				)
			);

			register_rest_route(
				$this->namespace,
				$base . $execution . '/deliveries',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_deliveries' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => self::pagination_args(),
				)
			);
		}
	}

	/**
	 * Page and page size arguments.
	 *
	 * @return array
	 */
	private static function pagination_args() {
		return array(
			'page'     => array(
				'type'    => 'integer',
				'minimum' => 1,
				'default' => 1,
			),
			'per_page' => array(
				'type'    => 'integer',
				'minimum' => 1,
				'maximum' => self::MAX_PER_PAGE,
				'default' => self::DEFAULT_PER_PAGE,
			),
		);
	}

	/**
	 * Only administrators read the notification history.
	 *
	 * @param WP_REST_Request|null $request Request.
	 * @return bool|WP_Error
	 */
	public function permissions_check( $request = null ) {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to read the notification history.', 'fair-events' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * One page of executions, newest first.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$scoped = null !== $request->get_param( 'id' );
		$page   = (int) $request->get_param( 'page' );
		$size   = (int) $request->get_param( 'per_page' );
		$result = $this->history->query(
			array(
				'config_id' => (string) ( $scoped ? $request->get_param( 'id' ) : $request->get_param( 'configuration' ) ),
				'channel'   => (string) $request->get_param( 'channel' ),
				'origin'    => (string) $request->get_param( 'origin' ),
				'outcome'   => (string) $request->get_param( 'outcome' ),
				'after'     => self::utc( $request->get_param( 'after' ) ),
				'before'    => self::utc( $request->get_param( 'before' ) ),
			),
			$page,
			$size
		);

		return self::paginated( array_map( array( $this, 'execution_payload' ), $result['items'] ), $result['total'], $size );
	}

	/**
	 * One execution.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$execution = $this->find_execution( $request );
		if ( is_wp_error( $execution ) ) {
			return $execution;
		}

		return rest_ensure_response( $this->execution_payload( $execution ) );
	}

	/**
	 * One page of an execution's deliveries, in the order they were recorded.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_deliveries( $request ) {
		$execution = $this->find_execution( $request );
		if ( is_wp_error( $execution ) ) {
			return $execution;
		}
		$size   = (int) $request->get_param( 'per_page' );
		$result = $this->history->deliveries( $execution['id'], (int) $request->get_param( 'page' ), $size );

		return self::paginated( array_map( array( $this, 'delivery_payload' ), $result['items'] ), $result['total'], $size );
	}

	/**
	 * The execution a request names, within its configuration when it names one.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	private function find_execution( $request ) {
		$execution = $this->history->get( (int) $request->get_param( 'execution' ) );
		$scope     = $request->get_param( 'id' );
		if ( ! $execution || ( null !== $scope && (string) $scope !== $execution['config_id'] ) ) {
			return new WP_Error(
				'unknown_execution',
				__( 'This notification history entry does not exist.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}
		return $execution;
	}

	/**
	 * Execution response.
	 *
	 * @param array $row Execution row.
	 * @return array
	 */
	public function execution_payload( array $row ) {
		$legacy = ExecutionHistory::LEGACY === $row['completeness'];

		return array(
			'id'            => $row['id'],
			'configuration' => array(
				'id'          => $row['config_id'],
				'name'        => $row['config_name'],
				// 'snapshot': as it was when it ran; 'migration_fallback': taken
				// from the configuration when older history was imported.
				'name_source' => $row['name_source'],
				'exists'      => Configurations::exists( $row['config_id'] ),
			),
			'channel'       => $row['channel'],
			'origin'        => $row['origin'],
			'occurrence'    => $row['occurrence'],
			'week_start'    => $row['week_start'],
			'week_end'      => $row['week_end'],
			'lifecycle'     => $row['lifecycle'],
			'outcome'       => '' === $row['outcome'] ? null : $row['outcome'],
			'reason_code'   => $row['reason_code'],
			'counts'        => array(
				'unit'     => $row['count_unit'],
				'accepted' => $row['accepted_count'],
				'failed'   => $row['failed_count'],
				'skipped'  => $row['skipped_count'],
				'unknown'  => $row['unknown_count'],
			),
			'completeness'  => $row['completeness'],
			'legacy'        => $legacy
				? array(
					'status'  => $row['legacy_status'],
					'message' => $row['legacy_message'],
				)
				: null,
			'started_at'    => self::rfc3339( $row['started_at'] ),
			'finished_at'   => self::rfc3339( $row['finished_at'] ),
		);
	}

	/**
	 * Delivery response.
	 *
	 * @param array $row Delivery row.
	 * @return array
	 */
	public function delivery_payload( array $row ) {
		return array(
			'id'             => (int) $row['id'],
			'recipient'      => $row['recipient'],
			'recipient_name' => $row['recipient_name'],
			'part'           => (int) $row['part'] ? (int) $row['part'] : null,
			'part_count'     => (int) $row['part_count'] ? (int) $row['part_count'] : null,
			'outcome'        => $row['outcome'],
			'reason_code'    => $row['reason_code'],
			'legacy'         => (bool) (int) $row['legacy'],
			'attempted_at'   => self::rfc3339( $row['attempted_at'] ),
			'finished_at'    => self::rfc3339( $row['finished_at'] ),
		);
	}

	/**
	 * A list response with WordPress' pagination headers.
	 *
	 * @param array[] $items    Items.
	 * @param int     $total    Total matching items.
	 * @param int     $per_page Page size.
	 * @return WP_REST_Response
	 */
	private static function paginated( array $items, $total, $per_page ) {
		$response = rest_ensure_response( $items );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) (int) ceil( $total / max( 1, $per_page ) ) );
		return $response;
	}

	/**
	 * A date-time filter as UTC 'Y-m-d H:i:s'.
	 *
	 * @param string|null $value RFC 3339 date-time; UTC when it has no offset.
	 * @return string
	 */
	private static function utc( $value ) {
		if ( null === $value || '' === $value ) {
			return '';
		}
		$timestamp = rest_parse_date( (string) $value );
		return false === $timestamp ? '' : gmdate( 'Y-m-d H:i:s', $timestamp );
	}

	/**
	 * A stored UTC time as RFC 3339.
	 *
	 * @param string|null $value UTC 'Y-m-d H:i:s'.
	 * @return string|null
	 */
	private static function rfc3339( $value ) {
		return null === $value || '' === $value ? null : gmdate( 'Y-m-d\TH:i:s\Z', strtotime( $value . ' UTC' ) );
	}
}
