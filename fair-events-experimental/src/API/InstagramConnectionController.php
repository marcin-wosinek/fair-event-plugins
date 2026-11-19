<?php
/**
 * Instagram connection administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Instagram\Authorization;
use FairEventsExperimental\Instagram\Connection;
use FairEventsExperimental\Instagram\Ownership;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Connection status, connecting through Meta's Unified Login (start, then
 * complete from the OAuth service's return, then confirm or cancel the
 * account choice when Meta shared several accounts), a connection test and
 * disconnecting, for Fair Events → Instagram.
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
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/authorize',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'start_authorization' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		$code_arg = static function ( $max ) {
			return array(
				'type'              => 'string',
				'default'           => '',
				'validate_callback' => static function ( $value ) use ( $max ) {
					return is_string( $value ) && strlen( $value ) <= $max && (bool) preg_match( '/^[A-Za-z0-9_-]*$/', $value );
				},
			);
		};

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/complete',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'complete_authorization' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'state'   => array_merge( $code_arg( 128 ), array( 'required' => true ) ),
					'handoff' => $code_arg( 64 ),
					'error'   => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_key',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/choice',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'confirm_choice' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'choice'     => array_merge( $code_arg( 64 ), array( 'required' => true ) ),
						'account_id' => array(
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => static function ( $value ) {
								return is_string( $value ) && (bool) preg_match( '/^\d{1,32}$/', $value );
							},
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'cancel_choice' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'choice' => array_merge( $code_arg( 64 ), array( 'required' => true ) ),
					),
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
	 * Start connecting: the authorize URL of the OAuth service, for this
	 * administrator only.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function start_authorization( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$url = Authorization::start( get_current_user_id() );
		if ( is_wp_error( $url ) ) {
			return $url;
		}

		return rest_ensure_response( array( 'authorize_url' => $url ) );
	}

	/**
	 * Complete connecting from the OAuth service's return parameters.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function complete_authorization( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$result = Authorization::complete( get_current_user_id(), $request['state'], $request['handoff'], $request['error'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Connect the account the administrator chose from the pending choice.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function confirm_choice( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$result = Authorization::confirm_choice( get_current_user_id(), $request['choice'], $request['account_id'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $this->response_data() );
	}

	/**
	 * Cancel the pending choice; the connection is kept.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function cancel_choice( $request ) {
		$refused = $this->refuse_unless_owner();
		if ( $refused ) {
			return $refused;
		}

		$result = Authorization::cancel_choice( get_current_user_id(), $request['choice'] );
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
	 * Check the token with Meta.
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
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// The page replaces its whole connection state with this response,
		// so add who manages the connection; the test's own keys (its
		// success message and refreshed details) take precedence.
		return rest_ensure_response( $result + $this->response_data() );
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
	 * Details plus who manages the connection, and the current
	 * administrator's pending account choice (IDs and usernames only).
	 *
	 * @return array<string,mixed>
	 */
	private function response_data() {
		$owns = Ownership::owns();

		return array_merge(
			Connection::details(),
			array(
				'managed_here'      => $owns,
				'ownership_reason'  => Ownership::reason(),
				'legacy_manage_url' => $owns ? null : admin_url( 'admin.php?page=fair-audience-settings' ),
				'pending_choice'    => $owns ? Authorization::pending_choice( get_current_user_id() ) : null,
			)
		);
	}
}
