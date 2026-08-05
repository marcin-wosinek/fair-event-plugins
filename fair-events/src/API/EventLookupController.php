<?php
/**
 * REST API Controller for looking up event metadata from a URL
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEventsShared\API\AbstractUrlLookupController;
use WP_REST_Server;
use WP_REST_Request;
use WP_Error;

/**
 * Fetches a user-supplied page server-side and extracts event metadata from it
 */
class EventLookupController extends AbstractUrlLookupController {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for URL lookup
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-events/v1/lookup-url - Fetch a page and extract event metadata.
		register_rest_route(
			$this->namespace,
			'/lookup-url',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'url' => array(
							'description'       => __( 'URL of the event page to look up.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => array( $this, 'validate_url_param' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Fetch the given URL server-side and extract event metadata from it
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		return $this->lookup_url( $request->get_param( 'url' ) );
	}

	/**
	 * Check permissions for looking up event metadata from a URL
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if user has permission, WP_Error otherwise.
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to look up event pages.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}
}
