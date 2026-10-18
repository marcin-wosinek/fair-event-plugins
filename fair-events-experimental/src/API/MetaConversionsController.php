<?php
/**
 * Meta Conversions administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Meta\Connector;
use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\Engagement;
use FairEventsExperimental\Meta\Outbox;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/**
 * Meta settings, test events and safe diagnostics.
 *
 * The access token is managed in Settings → Connectors. Responses report only
 * whether one is configured and where it comes from.
 */
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
			'/' . $this->rest_base . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'send_test' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'event_name'        => array(
						'type'              => 'string',
						'required'          => true,
						'enum'              => array( 'PageView', 'InitiateCheckout', 'Purchase', Conversions::ENGAGEMENT_EVENTS['calendar'] ),
						'sanitize_callback' => 'sanitize_text_field',
					),
					// Calendar test only: the event the activation belongs to
					// and the administrator browser's consent and identifiers.
					'post_id'           => array(
						'type'              => 'integer',
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'event_date_id'     => array(
						'type'              => 'integer',
						'minimum'           => 1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'marketing_consent' => array(
						'type'              => 'boolean',
						'default'           => false,
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

	/** @return bool */
	public function permissions_check() {
		return current_user_can( 'manage_options' ); }

	/** @param mixed $value Meta identifier, or empty. @return bool */
	public function validate_identifier( $value ) {
		return '' === $value || Conversions::valid_identifier( $value );
	}

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
		$token = Connector::status();
		return rest_ensure_response(
			array(
				'dataset_id'            => (string) get_option( Conversions::DATASET_OPTION, '' ),
				'token_configured'      => $token['configured'],
				'token_source'          => $token['source'],
				'token_override_name'   => Connector::CREDENTIAL_NAME,
				'connectors_url'        => Connector::admin_url(),
				'test_event_code'       => (string) get_option( Conversions::TEST_CODE_OPTION, '' ),
				'diagnostics'           => ( new Outbox() )->diagnostics(),
				'test_history'          => array_map( array( $this, 'with_local_time' ), Conversions::test_history() ),
				'consent_api_available' => function_exists( 'wp_has_consent' ),
			)
		);
	}

	/**
	 * Add a site-local, formatted display time alongside the raw UTC `time`.
	 *
	 * @param array $entry Test history entry with a UTC `time`.
	 * @return array
	 */
	private function with_local_time( $entry ) {
		$entry['time_local'] = wp_date(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			strtotime( $entry['time'] . ' UTC' )
		);
		return $entry;
	}

	/**
	 * Save the dataset ID and Test Events code. The access token is never
	 * written here.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function update_item( $request ) {
		// The token moved to Connectors; refuse it rather than appear to save it.
		if ( $request->has_param( 'access_token' ) ) {
			return new \WP_Error(
				'token_managed_in_connectors',
				__( 'The Meta access token is managed in Settings → Connectors. Nothing was saved.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		update_option( Conversions::DATASET_OPTION, (string) $request->get_param( 'dataset_id' ), false );
		update_option( Conversions::TEST_CODE_OPTION, (string) $request->get_param( 'test_event_code' ), false );
		return $this->get_item();
	}

	/**
	 * Send one test event and report Meta's allowlisted diagnostics on both
	 * success and failure. The calendar test needs marketing consent, a
	 * valid Meta identifier and a date of a public event; its source URL is
	 * resolved here, never taken from the request.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function send_test( $request ) {
		$event_name = (string) $request->get_param( 'event_name' );
		$engagement = null;
		if ( Conversions::ENGAGEMENT_EVENTS['calendar'] === $event_name ) {
			$engagement = $this->calendar_test_input( $request );
			if ( is_wp_error( $engagement ) ) {
				return $engagement;
			}
		}
		$result = ( new Conversions() )->send_test( $event_name, $engagement );
		if ( ! $result['accepted'] ) {
			$message = 'unconfirmed' === $result['outcome']
				? sprintf(
					/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
					__( 'Meta answered, but did not confirm receiving the %s test event.', 'fair-events-experimental' ),
					$event_name
				)
				: sprintf(
					/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
					__( 'Meta rejected the %s test event. Check the configuration and try again.', 'fair-events-experimental' ),
					$event_name
				);
			return new \WP_Error(
				'meta_test_failed',
				$message,
				array(
					'status'      => $result['temporary'] ? 503 : 400,
					'category'    => $result['type'],
					'code'        => $result['code'],
					'outcome'     => $result['outcome'],
					'diagnostics' => $result['diagnostics'],
				)
			);
		}
		return rest_ensure_response(
			array(
				'accepted'    => true,
				'event_name'  => $event_name,
				'outcome'     => $result['outcome'],
				'diagnostics' => $result['diagnostics'],
			)
		);
	}

	/**
	 * @param \WP_REST_Request $request Request.
	 * @return array|\WP_Error Engagement input for {@see Conversions::send_test()}.
	 */
	private function calendar_test_input( $request ) {
		if ( true !== $request->get_param( 'marketing_consent' ) ) {
			return new \WP_Error( 'marketing_consent_required', __( 'Marketing consent is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		$fbp = (string) $request->get_param( 'meta_fbp' );
		$fbc = (string) $request->get_param( 'meta_fbc' );
		if ( '' === $fbp && '' === $fbc ) {
			return new \WP_Error( 'meta_identifier_required', __( 'A Meta browser identifier is required.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}
		$context = Engagement::event_context( (int) $request->get_param( 'post_id' ), (int) $request->get_param( 'event_date_id' ) );
		if ( ! $context ) {
			return new \WP_Error( 'invalid_event', __( 'Event not found.', 'fair-events-experimental' ), array( 'status' => 404 ) );
		}
		return array(
			'context' => $context,
			'fbp'     => $fbp,
			'fbc'     => $fbc,
		);
	}
}
