<?php
/**
 * Instagram connection administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Instagram\Connection;
use FairEventsExperimental\Instagram\Ownership;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Connection status, connecting (manual token or OAuth return), the user ID,
 * a connection test and disconnecting, for Fair Events → Instagram.
 *
 * Registered while the `instagram` feature is on. Changes are refused while
 * this plugin does not own the connection; `ownership_reason` says why (see
 * {@see Ownership::reason()}). No response contains the access token.
 */
class InstagramConnectionController extends WP_REST_Controller {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events-experimental/v1';

	/**
	 * REST base.
	 *
	 * @var string
	 */
	protected $rest_base = 'instagram/connection';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$user_id_arg = array(
			'type'              => 'string',
			'default'           => '',
			'validate_callback' => array( $this, 'validate_user_id' ),
			'sanitize_callback' => static function ( $value ) {
				return trim( (string) $value );
			},
		);

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
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'access_token' => array(
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => array( $this, 'validate_token' ),
							'sanitize_callback' => static function ( $value ) {
								return trim( (string) $value );
							},
						),
						'user_id'      => $user_id_arg,
						'username'     => array(
							'type'              => 'string',
							'default'           => '',
							'sanitize_callback' => static function ( $value ) {
								return ltrim( sanitize_text_field( (string) $value ), '@' );
							},
						),
						'expires_in'   => array(
							'type'              => array( 'integer', 'null' ),
							'default'           => null,
							'minimum'           => 0,
							'validate_callback' => 'rest_validate_request_arg',
						),
					),
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
			'/' . $this->rest_base . '/user-id',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'update_user_id' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'user_id' => array_merge( $user_id_arg, array( 'required' => true ) ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_connection' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
	}

	/**
	 * Only administrators manage the connection.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Connection details.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request ) {
		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Store a token, from manual entry or the OAuth return.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$result = Connection::connect(
			$request['access_token'],
			$request['user_id'],
			$request['username'],
			null === $request['expires_in'] ? null : (int) $request['expires_in']
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Remove the token and connection details.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		Connection::disconnect();

		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Set the user ID by hand.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_user_id( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		Connection::set_user_id( $request['user_id'] );

		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Check the token with Instagram.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_connection( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$result = Connection::test();

		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	/**
	 * A token is a non-empty string without whitespace.
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	public function validate_token( $value ) {
		return is_string( $value ) && '' !== trim( $value ) && ! preg_match( '/\s/', trim( $value ) ) && strlen( trim( $value ) ) <= 2048;
	}

	/**
	 * A user ID is numeric, or '' when unknown.
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	public function validate_user_id( $value ) {
		return is_string( $value ) && ( '' === trim( $value ) || (bool) preg_match( '/^\d{1,32}$/', trim( $value ) ) );
	}

	/**
	 * The error to return while this plugin does not own the connection.
	 *
	 * @return WP_Error|null
	 */
	private function refuse_unless_owner() {
		if ( Ownership::owns() ) {
			return null;
		}

		$reason = Ownership::reason();

		return new WP_Error(
			'instagram_connection_not_owned',
			self::not_owned_message( $reason ),
			array(
				'status'           => 409,
				'ownership_reason' => $reason,
			)
		);
	}

	/**
	 * What to do while this plugin does not own the connection.
	 *
	 * @param string $reason Ownership reason.
	 * @return string
	 */
	private static function not_owned_message( $reason ) {
		switch ( $reason ) {
			case Ownership::REASON_AUDIENCE_HANDOFF_MISSING:
				return __( 'This site’s Fair Audience is older than this plugin and still manages the Instagram connection. Update Fair Audience to manage it here; until then, use Fair Audience → Settings → Instagram.', 'fair-events-experimental' );
			case Ownership::REASON_AUDIENCE_UPDATE_NOT_LOADED:
				return __( 'Fair Audience is updated, but the site still runs its previous code, so Fair Audience still manages the Instagram connection. Clear the PHP opcode cache or restart PHP, then try again.', 'fair-events-experimental' );
			case Ownership::REASON_FEATURE_OFF:
				return __( 'Instagram is turned off in Fair Events → Settings → Experimental. Turn it on to manage the connection here.', 'fair-events-experimental' );
			default:
				return __( 'Fair Events Experimental did not take over the Instagram connection on this request. Reload the page and try again.', 'fair-events-experimental' );
		}
	}

	/**
	 * Details plus who manages the connection.
	 *
	 * @return array<string,mixed>
	 */
	private function response_data() {
		return array_merge(
			Connection::details(),
			array(
				'managed_here'      => Ownership::owns(),
				'ownership_reason'  => Ownership::reason(),
				'legacy_manage_url' => Ownership::owns() ? null : admin_url( 'admin.php?page=fair-audience-settings' ),
			)
		);
	}
}
