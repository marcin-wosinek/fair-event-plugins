<?php
/**
 * Meta Conversions administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\Outbox;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/** Manages write-only Meta credentials and safe diagnostics. */
class MetaConversionsController extends WP_REST_Controller {
	protected $namespace = 'fair-events-experimental/v1';
	protected $rest_base = 'meta-conversions';

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
						'access_token'    => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
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
			'/' . $this->rest_base . '/token',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'clear_token' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'send_test' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
	}

	/** @return bool */
	public function permissions_check() {
		return current_user_can( 'manage_options' ); }

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
		return rest_ensure_response(
			array(
				'dataset_id'       => (string) get_option( Conversions::DATASET_OPTION, '' ),
				'token_configured' => '' !== (string) get_option( Conversions::TOKEN_OPTION, '' ),
				'test_event_code'  => (string) get_option( Conversions::TEST_CODE_OPTION, '' ),
				'diagnostics'      => ( new Outbox() )->diagnostics(),
			)
		);
	}

	/** @param \WP_REST_Request $request Request. @return \WP_REST_Response */
	public function update_item( $request ) {
		update_option( Conversions::DATASET_OPTION, (string) $request->get_param( 'dataset_id' ), false );
		update_option( Conversions::TEST_CODE_OPTION, (string) $request->get_param( 'test_event_code' ), false );
		$token = (string) $request->get_param( 'access_token' );
		if ( '' !== $token ) {
			update_option( Conversions::TOKEN_OPTION, $token, false ); }
		return $this->get_item();
	}

	/** @return \WP_REST_Response */
	public function clear_token() {
		delete_option( Conversions::TOKEN_OPTION );
		return $this->get_item(); }

	/** @return \WP_REST_Response|\WP_Error */
	public function send_test() {
		$result = ( new Conversions() )->send_test();
		if ( ! $result['accepted'] ) {
			return new \WP_Error(
				'meta_test_failed',
				__( 'Meta rejected the test event. Check the configuration and try again.', 'fair-events-experimental' ),
				array(
					'status'   => $result['temporary'] ? 503 : 400,
					'category' => $result['type'],
					'code'     => $result['code'],
				)
			); }
		return rest_ensure_response( array( 'accepted' => true ) );
	}
}
