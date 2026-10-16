<?php
/**
 * Meta button-click engagement capture REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\Engagement;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/** Queues consented calendar and ticket button clicks for Meta delivery. */
class MetaEngagementController extends WP_REST_Controller {
	protected $namespace = 'fair-events-experimental/v1';
	protected $rest_base = 'meta-engagement';

	/** Register routes. */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_item' ),
				// Public by design: anonymous visitors click event-page buttons.
				// The callback requires marketing consent, a valid Meta
				// identifier and a public event, and limits requests per IP.
				'permission_callback' => '__return_true',
				'args'                => array(
					'action'            => array(
						'type'              => 'string',
						'required'          => true,
						'enum'              => array_keys( Conversions::ENGAGEMENT_EVENTS ),
						'validate_callback' => 'rest_validate_request_arg',
					),
					'activation_id'     => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( $this, 'validate_activation_id' ),
					),
					'post_id'           => array(
						'type'              => 'integer',
						'required'          => true,
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'event_date_id'     => array(
						'type'              => 'integer',
						'required'          => true,
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'marketing_consent' => array(
						'type'              => 'boolean',
						'required'          => true,
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

	/** @param mixed $value Activation ID. @return bool */
	public function validate_activation_id( $value ) {
		return Conversions::valid_activation_id( $value );
	}

	/** @param mixed $value Meta identifier, or empty. @return bool */
	public function validate_identifier( $value ) {
		return '' === $value || Conversions::valid_identifier( $value );
	}

	/**
	 * Queue one engagement event. Answers 202 when queued and 200 with
	 * `queued: false` for a replayed activation or missing Meta credentials,
	 * so capture stays best effort for the page.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		if ( true !== $request->get_param( 'marketing_consent' ) ) {
			return new WP_Error( 'marketing_consent_required', __( 'Marketing consent is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		$fbp = (string) $request->get_param( 'meta_fbp' );
		$fbc = (string) $request->get_param( 'meta_fbc' );
		if ( '' === $fbp && '' === $fbc ) {
			return new WP_Error( 'meta_identifier_required', __( 'A Meta browser identifier is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		if ( ! Engagement::allow( $_SERVER['REMOTE_ADDR'] ?? '' ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- hashed into a transient key only.
			return new WP_Error( 'rate_limited', __( 'Too many requests. Try again later.', 'fair-events-experimental' ), array( 'status' => 429 ) );
		}
		$context = Engagement::event_context( (int) $request->get_param( 'post_id' ), (int) $request->get_param( 'event_date_id' ) );
		if ( ! $context ) {
			return new WP_Error( 'invalid_event', __( 'Event not found.', 'fair-events-experimental' ), array( 'status' => 404 ) );
		}
		$event    = Conversions::build_engagement_event( (string) $request->get_param( 'action' ), (string) $request->get_param( 'activation_id' ), $context, $fbp, $fbc );
		$queued   = $event ? ( new Conversions() )->enqueue_engagement( $event ) : false;
		$response = rest_ensure_response( array( 'queued' => $queued ) );
		$response->set_status( $queued ? 202 : 200 );
		return $response;
	}
}
