<?php
/**
 * Admin REST API controller for connected sites.
 *
 * Admin-only CRUD plus a connection test for the data sharing consumer side:
 * the remote sites this site pulls transaction data from.
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

use FairPayment\Models\ConnectedSite;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles admin endpoints for managing connected sites.
 */
class ConnectedSitesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payment/v1';

	/**
	 * Register the admin connected-sites routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$args = array(
			'label'    => array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'base_url' => array(
				'type'              => 'string',
				'sanitize_callback' => 'esc_url_raw',
			),
			'token'    => array(
				'type' => 'string',
			),
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $args,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites/(?P<id>\d+)/test',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'test_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);
	}

	/**
	 * Admin capability check for all routes.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * List all connected sites.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$data = array_map(
			array( ConnectedSite::class, 'to_array' ),
			ConnectedSite::get_all()
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a new connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$label    = (string) $request->get_param( 'label' );
		$base_url = (string) $request->get_param( 'base_url' );
		$token    = (string) $request->get_param( 'token' );

		if ( '' === trim( $label ) || '' === trim( $base_url ) || '' === trim( $token ) ) {
			return new WP_Error(
				'rest_invalid_connected_site',
				__( 'Label, base URL and token are all required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$record = ConnectedSite::create(
			array(
				'label'    => $label,
				'base_url' => $base_url,
				'token'    => $token,
			)
		);

		return new WP_REST_Response( ConnectedSite::to_array( $record ), 201 );
	}

	/**
	 * Update a connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		if ( ! ConnectedSite::get_by_id( $id ) ) {
			return $this->not_found();
		}

		$data = array();
		if ( null !== $request->get_param( 'label' ) ) {
			$data['label'] = (string) $request->get_param( 'label' );
		}
		if ( null !== $request->get_param( 'base_url' ) ) {
			$data['base_url'] = (string) $request->get_param( 'base_url' );
		}
		if ( null !== $request->get_param( 'token' ) ) {
			$data['token'] = (string) $request->get_param( 'token' );
		}

		$record = ConnectedSite::update( $id, $data );

		return new WP_REST_Response( ConnectedSite::to_array( $record ), 200 );
	}

	/**
	 * Delete a connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		if ( ! ConnectedSite::get_by_id( $id ) ) {
			return $this->not_found();
		}

		ConnectedSite::delete( $id );

		return new WP_REST_Response( array( 'deleted' => true ), 200 );
	}

	/**
	 * Test a connected site's token against its remote /external/me endpoint.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function test_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$record = ConnectedSite::get_by_id( $id );

		if ( ! $record ) {
			return $this->not_found();
		}

		$url = trailingslashit( $record['base_url'] ) . 'wp-json/fair-payment/v1/external/me';

		$response = wp_safe_remote_get(
			$url,
			array(
				'timeout' => 10,
				'headers' => array(
					'Authorization' => 'Bearer ' . $record['token'],
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			ConnectedSite::mark_failed( $id );

			return new WP_Error(
				'rest_connected_site_unreachable',
				__( 'Could not reach the remote site.', 'fair-payment' ),
				array( 'status' => 502 )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $body ) ) {
			ConnectedSite::mark_failed( $id );

			$message = 401 === $code || 403 === $code
				? __( 'The remote site rejected the token.', 'fair-payment' )
				: __( 'The remote site returned an unexpected response.', 'fair-payment' );

			return new WP_Error(
				'rest_connected_site_test_failed',
				$message,
				array( 'status' => 400 )
			);
		}

		$scopes = isset( $body['scopes'] ) && is_array( $body['scopes'] ) ? $body['scopes'] : array();
		ConnectedSite::record_test_result( $id, $scopes );

		return new WP_REST_Response(
			array(
				'ok'     => true,
				'label'  => isset( $body['label'] ) ? sanitize_text_field( $body['label'] ) : '',
				'scopes' => array_values( array_map( 'sanitize_text_field', $scopes ) ),
			),
			200
		);
	}

	/**
	 * Standard 404 error.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'rest_connected_site_not_found',
			__( 'Connected site not found.', 'fair-payment' ),
			array( 'status' => 404 )
		);
	}
}
