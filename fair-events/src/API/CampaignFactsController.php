<?php
/**
 * REST API Controller for campaign facts
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Services\CampaignFacts;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Exposes the authoritative event and venue facts of one occurrence for
 * campaign snapshots (#2420), and the public facts of a published one. See
 * CampaignFacts for the response shapes.
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
