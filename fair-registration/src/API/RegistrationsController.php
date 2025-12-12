<?php
/**
 * REST API controller for registrations
 *
 * @package FairRegistration
 */

namespace FairRegistration\API;

use FairRegistration\Core\Plugin;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Registrations REST API controller
 */
class RegistrationsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-registration/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'registrations';

	/**
	 * Register the routes for registrations
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /wp-json/fair-registration/v1/registrations
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_registration' ),
					'permission_callback' => array( $this, 'create_registration_permissions_check' ),
					'args'                => $this->get_registration_schema(),
				),
			)
		);

		// GET /wp-json/fair-registration/v1/registrations
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_registrations' ),
					'permission_callback' => array( $this, 'get_registrations_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);

		// GET /wp-json/fair-registration/v1/registrations/{id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_registration' ),
					'permission_callback' => array( $this, 'get_registration_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the registration.', 'fair-registration' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);
	}

	/**
	 * Create a new registration
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function create_registration( $request ) {
		$db_manager = Plugin::instance()->get_db_manager();

		// Prepare registration data
		$registration_data = array(
			'form_id'           => (int) $request->get_param( 'form_id' ),
			'url'               => sanitize_url( $request->get_param( 'url' ) ),
			'user_id'           => get_current_user_id() ?: null,
			'registration_data' => $request->get_param( 'registration_data' ),
		);

		// Validate form exists
		if ( ! $this->form_exists( $registration_data['form_id'] ) ) {
			return new WP_Error(
				'invalid_form_id',
				__( 'The specified form ID does not exist or does not contain a registration form.', 'fair-registration' ),
				array( 'status' => 400 )
			);
		}

		// Insert registration
		$registration_id = $db_manager->insert_registration( $registration_data );

		if ( ! $registration_id ) {
			return new WP_Error(
				'registration_creation_failed',
				__( 'Failed to create registration.', 'fair-registration' ),
				array( 'status' => 500 )
			);
		}

		// Get the created registration
		$registration = $db_manager->get_registration( $registration_id );

		if ( ! $registration ) {
			return new WP_Error(
				'registration_retrieval_failed',
				__( 'Registration was created but could not be retrieved.', 'fair-registration' ),
				array( 'status' => 500 )
			);
		}

		$response = $this->prepare_item_for_response( $registration, $request );
		$response->set_status( 201 );

		return $response;
	}

	/**
	 * Get registrations collection
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_registrations( $request ) {
		$db_manager = Plugin::instance()->get_db_manager();

		$form_id = $request->get_param( 'form_id' );
		$limit   = $request->get_param( 'per_page' );
		$offset  = ( $request->get_param( 'page' ) - 1 ) * $limit;

		if ( $form_id ) {
			$registrations = $db_manager->get_registrations_by_form( $form_id, $limit, $offset );
		} else {
			$registrations = $db_manager->get_all_registrations( $limit, $offset );
		}

		$data = array();
		foreach ( $registrations as $registration ) {
			$data[] = $this->prepare_item_for_response( $registration, $request );
		}

		return rest_ensure_response( $data );
	}

	/**
	 * Get a single registration
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_registration( $request ) {
		$db_manager = Plugin::instance()->get_db_manager();
		$id         = (int) $request->get_param( 'id' );

		$registration = $db_manager->get_registration( $id );

		if ( ! $registration ) {
			return new WP_Error(
				'registration_not_found',
				__( 'Registration not found.', 'fair-registration' ),
				array( 'status' => 404 )
			);
		}

		$response = $this->prepare_item_for_response( $registration, $request );

		return $response;
	}

	/**
	 * Check permissions for creating registrations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function create_registration_permissions_check( $request ) {
		// Public endpoint - allows anonymous registrations
		// Nonce verification is automatically handled by WordPress REST API when using apiFetch()
		// Frontend MUST use apiFetch() from @wordpress/api-fetch for nonce to be sent
		// See: REST_API_BACKEND.md for security details
		return true;
	}

	/**
	 * Check permissions for reading registrations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_registrations_permissions_check( $request ) {
		// Only allow users with manage_options capability to read registrations
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for reading a single registration
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_registration_permissions_check( $request ) {
		// Only allow users with manage_options capability to read registrations
		return current_user_can( 'manage_options' );
	}

	/**
	 * Prepare registration for response
	 *
	 * @param array           $registration Registration data.
	 * @param WP_REST_Request $request     Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function prepare_item_for_response( $registration, $request ) {
		$data = array(
			'id'                => (int) $registration['id'],
			'form_id'           => (int) $registration['form_id'],
			'user_id'           => $registration['user_id'] ? (int) $registration['user_id'] : null,
			'url'               => $registration['url'],
			'registration_data' => $registration['registration_data'],
			'created'           => $registration['created'],
			'modified'          => $registration['modified'],
		);

		$response = rest_ensure_response( $data );

		return $response;
	}

	/**
	 * Get registration schema for validation
	 *
	 * @return array Schema array.
	 */
	public function get_registration_schema() {
		return array(
			'form_id'           => array(
				'description' => __( 'The ID of the post/page containing the registration form.', 'fair-registration' ),
				'type'        => 'integer',
				'required'    => true,
				'minimum'     => 1,
			),
			'url'               => array(
				'description' => __( 'The URL where the registration was submitted.', 'fair-registration' ),
				'type'        => 'string',
				'format'      => 'uri',
				'required'    => true,
			),
			'registration_data' => array(
				'description' => __( 'The registration form data as an array of field objects.', 'fair-registration' ),
				'type'        => 'array',
				'required'    => true,
				'items'       => array(
					'type'       => 'object',
					'properties' => array(
						'name'  => array(
							'type'        => 'string',
							'description' => __( 'Field name/identifier', 'fair-registration' ),
							'required'    => true,
						),
						'value' => array(
							'type'        => 'string',
							'description' => __( 'Field value', 'fair-registration' ),
							'required'    => true,
						),
					),
				),
			),
		);
	}

	/**
	 * Get collection parameters
	 *
	 * @return array Collection parameters.
	 */
	public function get_collection_params() {
		return array(
			'form_id'  => array(
				'description' => __( 'Filter registrations by form ID.', 'fair-registration' ),
				'type'        => 'integer',
			),
			'page'     => array(
				'description' => __( 'Current page of the collection.', 'fair-registration' ),
				'type'        => 'integer',
				'default'     => 1,
				'minimum'     => 1,
			),
			'per_page' => array(
				'description' => __( 'Maximum number of items to return per page.', 'fair-registration' ),
				'type'        => 'integer',
				'default'     => 10,
				'minimum'     => 1,
				'maximum'     => 100,
			),
		);
	}

	/**
	 * Check if a form exists and contains registration blocks
	 *
	 * @param int $form_id Post/page ID.
	 * @return bool True if form exists and contains registration blocks.
	 */
	private function form_exists( $form_id ) {
		$post = get_post( $form_id );

		if ( ! $post || $post->post_status !== 'publish' ) {
			return false;
		}

		// Check if post contains registration form blocks
		return has_block( 'fair-registration/form', $post );
	}
}
