<?php
/**
 * Shared admin REST controller for data sharing API tokens
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Lists, creates and revokes API tokens for administrators.
 *
 * A plugin's controller extends this one, sets its REST `$namespace`, names
 * its token model (a subclass of FairEventsShared\ApiTokens\AbstractApiToken)
 * and supplies its own translated error messages, so each plugin keeps a
 * literal text domain. The plaintext token is returned only by create_item().
 *
 * Plugins bundling different versions of this package can be active
 * together, and either copy may be the one loaded. Keep this class
 * additive: never add an abstract method or change a signature.
 */
abstract class AbstractApiTokensController extends WP_REST_Controller {

	/**
	 * Token model class, a subclass of AbstractApiToken.
	 *
	 * @return string Class name.
	 */
	abstract protected function token_model();

	/**
	 * Message for a missing or blank label.
	 *
	 * @return string
	 */
	abstract protected function invalid_label_message();

	/**
	 * Message for missing or unsupported scopes.
	 *
	 * @return string
	 */
	abstract protected function invalid_scopes_message();

	/**
	 * Message for a token that could not be stored.
	 *
	 * @return string
	 */
	abstract protected function creation_failed_message();

	/**
	 * Message for an unknown token ID.
	 *
	 * @return string
	 */
	abstract protected function not_found_message();

	/**
	 * Register the admin API token routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$model = $this->token_model();

		register_rest_route(
			$this->namespace,
			'/admin/api-tokens',
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
					'args'                => array(
						'label'  => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'scopes' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type' => 'string',
								'enum' => $model::ALLOWED_SCOPES,
							),
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/api-tokens/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
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
	 * List all API tokens.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$model = $this->token_model();

		$data = array_map(
			array( $model, 'to_array' ),
			$model::get_all()
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a new API token.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$model  = $this->token_model();
		$label  = $request->get_param( 'label' );
		$scopes = (array) $request->get_param( 'scopes' );

		if ( empty( $label ) ) {
			return new WP_Error(
				'rest_invalid_label',
				$this->invalid_label_message(),
				array( 'status' => 400 )
			);
		}

		// The route's enum already rejects unsupported scopes; a request is
		// never granted a subset of what it asked for.
		if ( empty( $scopes ) || array_diff( $scopes, $model::ALLOWED_SCOPES ) ) {
			return new WP_Error(
				'rest_invalid_scopes',
				$this->invalid_scopes_message(),
				array( 'status' => 400 )
			);
		}

		$result = $model::create( $label, array_values( array_unique( $scopes ) ) );

		if ( ! $result ) {
			return new WP_Error(
				'rest_api_token_creation_failed',
				$this->creation_failed_message(),
				array( 'status' => 500 )
			);
		}

		$response = $model::to_array( $model::get_by_id( $result['id'] ) );

		// One-time plaintext token; never retrievable again.
		$response['token'] = $result['token'];

		return new WP_REST_Response( $response, 201 );
	}

	/**
	 * Revoke an API token.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$model = $this->token_model();
		$id    = (int) $request->get_param( 'id' );

		if ( ! $model::get_by_id( $id ) ) {
			return new WP_Error(
				'rest_api_token_not_found',
				$this->not_found_message(),
				array( 'status' => 404 )
			);
		}

		$model::revoke( $id );

		return new WP_REST_Response( $model::to_array( $model::get_by_id( $id ) ), 200 );
	}
}
