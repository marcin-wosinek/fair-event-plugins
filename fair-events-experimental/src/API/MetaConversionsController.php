<?php
/**
 * Meta Conversions administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Meta\Connector;
use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\DeliveryAttempts;
use FairEventsExperimental\Meta\Engagement;
use FairEventsExperimental\Meta\Outbox;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/**
 * Meta settings, test events and safe diagnostics.
 *
 * The access token is managed in Settings → Connectors. Responses report only
 * whether one is configured and where it comes from.
 */
class MetaConversionsController extends WP_REST_Controller {
	protected $namespace = 'fair-events-experimental/v1';
	protected $rest_base = 'meta-conversions';

	/** Most events one calendar-events page returns. */
	public const CALENDAR_EVENTS_PER_PAGE = 100;

	/** Candidate rows read per query while filling a calendar-events page. */
	private const CALENDAR_EVENTS_BATCH = 200;

	/** Most sent-request log entries one page returns. */
	public const ATTEMPTS_PER_PAGE = 50;

	/** Register routes. */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'dataset_id'      => array(
							'type'              => 'string',
							'sanitize_callback' => array( $this, 'sanitize_dataset_id' ),
						),
						'test_event_code' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/calendar-events',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_calendar_events' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'search'   => array(
						'type'              => 'string',
						'default'           => '',
						'maxLength'         => 200,
						'validate_callback' => 'rest_validate_request_arg',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'page'     => array(
						'type'              => 'integer',
						'default'           => 1,
						'minimum'           => 1,
						'maximum'           => 1000,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'per_page' => array(
						'type'              => 'integer',
						'default'           => self::CALENDAR_EVENTS_PER_PAGE,
						'minimum'           => 1,
						'maximum'           => self::CALENDAR_EVENTS_PER_PAGE,
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/attempts',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_attempts' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'page'       => array(
						'type'              => 'integer',
						'default'           => 1,
						'minimum'           => 1,
						'maximum'           => 1000,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'per_page'   => array(
						'type'              => 'integer',
						'default'           => 20,
						'minimum'           => 1,
						'maximum'           => self::ATTEMPTS_PER_PAGE,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'origin'     => array(
						'type'              => 'string',
						'default'           => '',
						'enum'              => array_merge( array( '' ), DeliveryAttempts::ORIGINS ),
						'validate_callback' => 'rest_validate_request_arg',
					),
					'event_name' => array(
						'type'              => 'string',
						'default'           => '',
						'pattern'           => '^([A-Za-z][A-Za-z0-9_]{0,63})?$',
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'send_test' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'event_name'        => array(
						'type'              => 'string',
						'required'          => true,
						'enum'              => array( 'PageView', 'InitiateCheckout', 'Purchase', Conversions::ENGAGEMENT_EVENTS['calendar'] ),
						'sanitize_callback' => 'sanitize_text_field',
					),
					// Calendar test only: the event the activation belongs to
					// and the administrator browser's consent and identifiers.
					'post_id'           => array(
						'type'              => 'integer',
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'event_date_id'     => array(
						'type'              => 'integer',
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'marketing_consent' => array(
						'type'              => 'boolean',
						'default'           => false,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'meta_fbp'          => array(
						'type'              => 'string',
						'default'           => '',
						'validate_callback' => array( $this, 'validate_identifier' ),
					),
					'meta_fbc'          => array(
						'type'              => 'string',
						'default'           => '',
						'validate_callback' => array( $this, 'validate_identifier' ),
					),
				),
			)
		);
	}

	/** @return bool */
	public function permissions_check() {
		return current_user_can( 'manage_options' ); }

	/** @param mixed $value Meta identifier, or empty. @return bool */
	public function validate_identifier( $value ) {
		return '' === $value || Conversions::valid_identifier( $value );
	}

	/** @param string $value Dataset ID. @return string */
	public function sanitize_dataset_id( $value ) {
		return preg_match( '/^\d{1,32}$/', $value ) ? $value : ''; }

	/**
	 * Read configuration and sanitized diagnostics.
	 *
	 * @param \WP_REST_Request|null $request Request, unused for reads.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request = null ) {
		unset( $request );
		$token = Connector::status();
		return rest_ensure_response(
			array(
				'dataset_id'            => (string) get_option( Conversions::DATASET_OPTION, '' ),
				'token_configured'      => $token['configured'],
				'token_source'          => $token['source'],
				'token_override_name'   => Connector::CREDENTIAL_NAME,
				'connectors_url'        => Connector::admin_url(),
				'test_event_code'       => (string) get_option( Conversions::TEST_CODE_OPTION, '' ),
				'diagnostics'           => ( new Outbox() )->diagnostics(),
				'test_history'          => array_map( array( $this, 'with_local_time' ), Conversions::test_history() ),
				'consent_api_available' => function_exists( 'wp_has_consent' ),
			)
		);
	}

	/**
	 * Sent requests, newest first, each paired with Meta's answer. Only
	 * sanitized snapshots and allowlisted diagnostics are returned; attempts
	 * past the retention period are never listed.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function get_attempts( $request ) {
		$per_page = (int) $request->get_param( 'per_page' );
		$page     = ( new DeliveryAttempts() )->query(
			array(
				'page'       => (int) $request->get_param( 'page' ),
				'per_page'   => $per_page,
				'origin'     => (string) $request->get_param( 'origin' ),
				'event_name' => (string) $request->get_param( 'event_name' ),
			)
		);
		return rest_ensure_response(
			array(
				'items'       => $page['items'],
				'total'       => $page['total'],
				'total_pages' => max( 1, (int) ceil( $page['total'] / $per_page ) ),
			)
		);
	}

	/**
	 * Add a site-local, formatted display time alongside the raw UTC `time`.
	 *
	 * @param array $entry Test history entry with a UTC `time`.
	 * @return array
	 */
	private function with_local_time( $entry ) {
		$entry['time_local'] = wp_date(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			strtotime( $entry['time'] . ' UTC' )
		);
		return $entry;
	}

	/**
	 * Save the dataset ID and Test Events code. The access token is never
	 * written here.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function update_item( $request ) {
		// The token moved to Connectors; refuse it rather than appear to save it.
		if ( $request->has_param( 'access_token' ) ) {
			return new \WP_Error(
				'token_managed_in_connectors',
				__( 'The Meta access token is managed in Settings → Connectors. Nothing was saved.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		update_option( Conversions::DATASET_OPTION, (string) $request->get_param( 'dataset_id' ), false );
		update_option( Conversions::TEST_CODE_OPTION, (string) $request->get_param( 'test_event_code' ), false );
		return $this->get_item();
	}

	/**
	 * Send one test event and report Meta's allowlisted diagnostics and the
	 * sanitized request snapshot on both success and failure; `request` is
	 * null when nothing was sent. The calendar test needs marketing consent, a
	 * valid Meta identifier and a date of a public event; its source URL is
	 * resolved here, never taken from the request.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function send_test( $request ) {
		$event_name = (string) $request->get_param( 'event_name' );
		$engagement = null;
		if ( Conversions::ENGAGEMENT_EVENTS['calendar'] === $event_name ) {
			$engagement = $this->calendar_test_input( $request );
			if ( is_wp_error( $engagement ) ) {
				return $engagement;
			}
		}
		$result = ( new Conversions() )->send_test( $event_name, $engagement );
		if ( ! $result['accepted'] ) {
			$message = 'unconfirmed' === $result['outcome']
				? sprintf(
					/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
					__( 'Meta answered, but did not confirm receiving the %s test event.', 'fair-events-experimental' ),
					$event_name
				)
				: sprintf(
					/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
					__( 'Meta rejected the %s test event. Check the configuration and try again.', 'fair-events-experimental' ),
					$event_name
				);
			return new \WP_Error(
				'meta_test_failed',
				$message,
				array(
					'status'      => $result['temporary'] ? 503 : 400,
					'category'    => $result['type'],
					'code'        => $result['code'],
					'outcome'     => $result['outcome'],
					'diagnostics' => $result['diagnostics'],
					'request'     => $result['request'],
				)
			);
		}
		return rest_ensure_response(
			array(
				'accepted'    => true,
				'event_name'  => $event_name,
				'outcome'     => $result['outcome'],
				'diagnostics' => $result['diagnostics'],
				'request'     => $result['request'],
			)
		);
	}

	/**
	 * Events the calendar test can be sent for, newest first: each linked
	 * event with the dates {@see Engagement::event_context()} accepts for its
	 * page, cancelled dates left out. A series is one group with its dates.
	 * Eligibility is applied before paging, so ineligible rows never take a
	 * page's places.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function get_calendar_events( $request ) {
		global $wpdb;
		$post_types = class_exists( \FairEvents\Settings\Settings::class ) ? \FairEvents\Settings\Settings::get_enabled_post_types() : array();
		if ( empty( $post_types ) ) {
			return rest_ensure_response( array() );
		}
		$per_page = (int) $request->get_param( 'per_page' );
		$skip     = ( (int) $request->get_param( 'page' ) - 1 ) * $per_page;
		$search   = (string) $request->get_param( 'search' );
		$dates    = $wpdb->prefix . 'fair_event_dates';

		// Narrow candidates to rows linked to a published, unprotected post of
		// an event type; event_context() still decides eligibility.
		$where  = "d.occurrence_type IN ('single', 'master') AND p.post_status = 'publish' AND p.post_password = ''";
		$where .= ' AND p.post_type IN (' . implode( ', ', array_fill( 0, count( $post_types ), '%s' ) ) . ')';
		$values = $post_types;
		if ( '' !== $search ) {
			$where   .= ' AND d.title LIKE %s';
			$values[] = '%' . $wpdb->esc_like( $search ) . '%';
		}

		$needed = $skip + $per_page;
		$groups = array();
		$offset = 0;
		do {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where holds only fixed SQL and placeholders, filled by the spread values.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT d.* FROM %i d JOIN %i p ON p.ID = d.event_id WHERE $where ORDER BY d.start_date DESC, d.start_time DESC, d.id DESC LIMIT %d OFFSET %d",
					$dates,
					$wpdb->posts,
					...array_merge( $values, array( self::CALENDAR_EVENTS_BATCH, $offset ) )
				)
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
			$groups  = array_merge( $groups, $this->calendar_groups( $rows ) );
			$offset += self::CALENDAR_EVENTS_BATCH;
			$more    = count( $rows ) === self::CALENDAR_EVENTS_BATCH && count( $groups ) < $needed;
		} while ( $more );
		return rest_ensure_response( array_slice( $groups, $skip, $per_page ) );
	}

	/**
	 * @param array $rows Top-level event date rows linked to a post.
	 * @return array Groups with at least one eligible, non-cancelled date.
	 */
	private function calendar_groups( array $rows ) {
		global $wpdb;
		$master_ids = array();
		foreach ( $rows as $row ) {
			if ( 'master' === $row->occurrence_type ) {
				$master_ids[] = (int) $row->id;
			}
		}
		$children = array();
		if ( $master_ids ) {
			$placeholders = implode( ', ', array_fill( 0, count( $master_ids ), '%d' ) );
			// phpcs:disable WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a fixed run of %d tokens, one per spread ID.
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i WHERE master_id IN ($placeholders) AND occurrence_type = 'generated' ORDER BY start_date ASC, start_time ASC",
					$wpdb->prefix . 'fair_event_dates',
					...$master_ids
				)
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
			foreach ( $results as $child ) {
				$children[ (int) $child->master_id ][] = $child;
			}
		}

		$groups = array();
		foreach ( $rows as $row ) {
			$occurrences = array_filter(
				array_merge( array( $row ), $children[ (int) $row->id ] ?? array() ),
				static function ( $date ) {
					return 'cancelled' !== $date->status;
				}
			);
			$eligible    = Engagement::eligible_dates( (int) $row->event_id, $occurrences );
			if ( ! $eligible ) {
				continue;
			}
			$groups[] = array_merge(
				$this->calendar_date( $row ),
				array(
					'event_id'    => (int) $row->event_id,
					'title'       => (string) $row->title,
					'occurrences' => array_map( array( $this, 'calendar_date' ), $eligible ),
				)
			);
		}
		return $groups;
	}

	/** @param object $row Event date row. @return array The picker's fields of a date. */
	private function calendar_date( $row ) {
		$all_day = ! empty( $row->all_day );
		return array(
			'id'         => (int) $row->id,
			'start_date' => $row->start_date ? (string) $row->start_date : null,
			'start_time' => ! $all_day && $row->start_time ? (string) $row->start_time : null,
			'all_day'    => $all_day,
		);
	}

	/**
	 * @param \WP_REST_Request $request Request.
	 * @return array|\WP_Error Engagement input for {@see Conversions::send_test()}.
	 */
	private function calendar_test_input( $request ) {
		if ( true !== $request->get_param( 'marketing_consent' ) ) {
			return new \WP_Error( 'marketing_consent_required', __( 'Marketing consent is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		$fbp = (string) $request->get_param( 'meta_fbp' );
		$fbc = (string) $request->get_param( 'meta_fbc' );
		if ( '' === $fbp && '' === $fbc ) {
			return new \WP_Error( 'meta_identifier_required', __( 'A Meta browser identifier is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		$context = Engagement::event_context( (int) $request->get_param( 'post_id' ), (int) $request->get_param( 'event_date_id' ) );
		if ( ! $context ) {
			// Publication or dates may have changed since the event was picked.
			return new \WP_Error(
				'invalid_event',
				__( 'The selected event page or date can no longer receive calendar clicks, so nothing was sent to Meta. Select an event from the list again.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}
		return array(
			'context'    => $context,
			'fbp'        => $fbp,
			'fbc'        => $fbc,
			'user_agent' => $request->get_header( 'user_agent' ),
		);
	}
}
