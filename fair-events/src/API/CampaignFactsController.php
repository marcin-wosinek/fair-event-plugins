<?php
/**
 * REST API Controller for campaign facts
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Services\CampaignFacts;
use FairEvents\Services\CompleteCampaignFacts;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Exposes the authoritative event and venue facts of one occurrence for
 * campaign snapshots (#2420), the complete source facts of a snapshot
 * (#2424), and the public facts of a published one. See CampaignFacts and
 * CompleteCampaignFacts for the response shapes.
 */
class CampaignFactsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/event-dates/{id}/campaign-facts.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/campaign-facts',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// GET /fair-events/v1/event-dates/{id}/campaign-facts/complete.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/campaign-facts/complete',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_complete_item' ),
					'permission_callback' => array( $this, 'get_complete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// GET /fair-events/v1/event-dates/{id}/public-campaign-facts.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/public-campaign-facts',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_public_item' ),
					// Public on purpose: only published events are answered,
					// with a fixed list of public-facing fields (see
					// CampaignFacts::read_public()); drafts read as missing.
					'permission_callback' => '__return_true',
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Campaign facts are read with the capability that reads event dates.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in.', 'fair-events' ),
				array( 'status' => 401 )
			);
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to read this event.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * The complete read also needs permission to edit the event's page: the
	 * linked post's `edit_post`, which for a generated occurrence is the
	 * series' page (as the event-images read). A missing event date passes
	 * through to the callback's 404.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the user has permission.
	 */
	public function get_complete_item_permissions_check( $request ) {
		$allowed = $this->get_item_permissions_check( $request );
		if ( true !== $allowed ) {
			return $allowed;
		}

		$event_date = EventDates::get_by_id( (int) $request->get_param( 'id' ) );
		if ( ! $event_date ) {
			return true;
		}

		$post_id = (int) $event_date->get_resolved_event_id();
		if ( $post_id > 0 && get_post( $post_id ) && ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to read this event.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Get the complete campaign facts of an event date, read in one
	 * database snapshot. Never cached by clients or proxies.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_complete_item( $request ) {
		$facts = CompleteCampaignFacts::read( (int) $request->get_param( 'id' ) );

		$response = is_wp_error( $facts )
			? rest_convert_error_to_response( $facts )
			: new WP_REST_Response( $facts, 200 );
		$response->header( 'Cache-Control', 'no-store' );

		return $response;
	}

	/**
	 * Get the campaign facts of an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_item( $request ) {
		$facts = CampaignFacts::read( (int) $request->get_param( 'id' ) );

		if ( is_wp_error( $facts ) ) {
			return $facts;
		}

		return new WP_REST_Response( $facts, 200 );
	}

	/**
	 * Get the public campaign facts of a published event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_public_item( $request ) {
		$facts = CampaignFacts::read_public( (int) $request->get_param( 'id' ) );

		if ( is_wp_error( $facts ) ) {
			return $facts;
		}

		return new WP_REST_Response( $facts, 200 );
	}
}
