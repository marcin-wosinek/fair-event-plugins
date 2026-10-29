<?php
/**
 * WhatsApp connection administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\WhatsApp\Client;
use FairEventsExperimental\WhatsApp\Configuration;
use FairEventsExperimental\WhatsApp\Connector;
use FairEventsExperimental\WhatsApp\Deliveries;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/**
 * WhatsApp IDs, connection validation, webhook credentials, one explicit
 * test template send and the history of sends with their delivery updates.
 *
 * The access token is managed in Settings → Connectors; the webhook's App
 * Secret and verify token are saved here. Responses report only whether each
 * is configured and where it comes from. Nothing here schedules or retries
 * a message.
 */
class WhatsAppController extends WP_REST_Controller {
	protected $namespace = 'fair-events-experimental/v1';
	protected $rest_base = 'whatsapp';

	/** Sends listed in the history. */
	private const HISTORY_SIZE = 20;

	/** Register routes. */
	public function register_routes() {
		$id_arg = array(
			'type'              => 'string',
			'required'          => true,
			'validate_callback' => array( $this, 'validate_id' ),
			'sanitize_callback' => array( $this, 'sanitize_id' ),
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
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'waba_id'         => $id_arg,
						'phone_number_id' => $id_arg,
					),
				),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/validate',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'validate_connection' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/templates',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_templates' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
		$credential_arg = static function ( $kind ) {
			return array(
				'type'              => 'string',
				'validate_callback' => static function ( $value ) use ( $kind ) {
					return is_string( $value ) && ( '' === trim( $value ) || Connector::valid_webhook_credential( $kind, trim( $value ) ) );
				},
				'sanitize_callback' => static function ( $value ) {
					return trim( (string) $value );
				},
			);
		};
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/webhook-credentials',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'update_webhook_credentials' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'app_secret'   => $credential_arg( 'app_secret' ),
					'verify_token' => $credential_arg( 'verify_token' ),
				),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/deliveries',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_deliveries' ),
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
				'args'                => array(
					'recipient'         => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( $this, 'validate_recipient' ),
					),
					'template_name'     => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( Client::class, 'valid_template_name' ),
					),
					'template_language' => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( Client::class, 'valid_language' ),
					),
					'authorized'        => array(
						'type'              => 'boolean',
						'required'          => true,
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);
	}

	/** @return bool */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/** @param mixed $value ID, or '' to remove it. @return bool */
	public function validate_id( $value ) {
		return is_string( $value ) && ( '' === trim( $value ) || Configuration::valid_id( trim( $value ) ) );
	}

	/** @param string $value ID. @return string */
	public function sanitize_id( $value ) {
		return trim( (string) $value );
	}

	/**
	 * The recipient is checked here but never echoed back in the error.
	 *
	 * @param mixed $value Recipient number as typed.
	 * @return true|WP_Error
	 */
	public function validate_recipient( $value ) {
		if ( '' !== Client::normalize_recipient( $value ) ) {
			return true;
		}
		return new WP_Error(
			'invalid_recipient',
			__( 'Enter the recipient number in international format, with the country code, such as +34 600 123 456.', 'fair-events-experimental' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Saved IDs, token status and the validation that still applies.
	 *
	 * @param \WP_REST_Request|null $request Request, unused for reads.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request = null ) {
		unset( $request );
		$token      = Connector::status();
		$validation = Configuration::validation();
		if ( $validation ) {
			$validation['validated_at_local'] = wp_date(
				get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
				strtotime( $validation['validated_at'] . ' UTC' )
			);
		}
		return rest_ensure_response(
			array_merge(
				Configuration::ids(),
				array(
					'token_configured'    => $token['configured'],
					'token_source'        => $token['source'],
					'token_override_name' => Connector::CREDENTIAL_NAME,
					'connectors_url'      => Connector::admin_url(),
					'validation'          => $validation,
					'webhook'             => $this->webhook_status(),
				)
			)
		);
	}

	/**
	 * Save both IDs without contacting Meta. The access token is never written
	 * here.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		if ( $request->has_param( 'access_token' ) ) {
			return new WP_Error(
				'token_managed_in_connectors',
				__( 'The WhatsApp access token is managed in Settings → Connectors. Nothing was saved.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		Configuration::save( (string) $request->get_param( 'waba_id' ), (string) $request->get_param( 'phone_number_id' ) );
		return $this->get_item();
	}

	/**
	 * Save or remove the webhook's App Secret and verify token. An omitted
	 * field is left unchanged, '' removes it. Values are never returned, and
	 * a rejected value is never repeated in the error.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_webhook_credentials( $request ) {
		$kinds = array_filter( array_keys( Connector::WEBHOOK ), array( $request, 'has_param' ) );
		if ( ! $kinds ) {
			return new WP_Error(
				'nothing_to_save',
				__( 'Enter an App Secret or a verify token to save.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		foreach ( $kinds as $kind ) {
			Connector::save_webhook_credential( $kind, (string) $request->get_param( $kind ) );
		}
		return $this->get_item();
	}

	/**
	 * Recent sends with their delivery state, newest first.
	 *
	 * @return \WP_REST_Response
	 */
	public function get_deliveries() {
		return rest_ensure_response(
			array(
				'items'          => array_map( array( $this, 'present_delivery' ), ( new Deliveries() )->recent( self::HISTORY_SIZE ) ),
				'retention_days' => Deliveries::RETENTION_DAYS,
				'webhook'        => $this->webhook_status(),
			)
		);
	}

	/**
	 * Check the saved IDs against Meta with the token in effect. Success
	 * records the sender; any failure clears the previous result.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function validate_connection() {
		$ready = $this->ready();
		if ( is_wp_error( $ready ) ) {
			Configuration::clear_validation();
			return $ready;
		}
		$ids    = Configuration::ids();
		$result = ( new Client( Connector::token() ) )->validate( $ids['waba_id'], $ids['phone_number_id'] );
		if ( ! $result['ok'] ) {
			Configuration::clear_validation();
			return $this->remote_error( $result );
		}
		Configuration::record_validation( $result['sender'] );
		return $this->get_item();
	}

	/**
	 * Approved templates without parameters, for the validated account.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_templates() {
		$ready = $this->ready( true );
		if ( is_wp_error( $ready ) ) {
			return $ready;
		}
		$result = ( new Client( Connector::token() ) )->templates( Configuration::ids()['waba_id'] );
		if ( ! $result['ok'] ) {
			return $this->remote_error( $result );
		}
		return rest_ensure_response( $result['templates'] );
	}

	/**
	 * Send the selected template once to a recipient who agreed to receive
	 * it. The template must still be an approved parameterless one. The
	 * recipient is not stored and is returned masked.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function send_test( $request ) {
		if ( true !== $request->get_param( 'authorized' ) ) {
			return new WP_Error(
				'authorization_required',
				__( 'Confirm that the recipient agreed to receive this test message. Nothing was sent.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		$ready = $this->ready( true );
		if ( is_wp_error( $ready ) ) {
			return $ready;
		}

		$name      = (string) $request->get_param( 'template_name' );
		$language  = (string) $request->get_param( 'template_language' );
		$client    = new Client( Connector::token() );
		$ids       = Configuration::ids();
		$templates = $client->templates( $ids['waba_id'] );
		if ( ! $templates['ok'] ) {
			return $this->remote_error( $templates );
		}
		$offered = array_filter(
			$templates['templates'],
			static function ( $template ) use ( $name, $language ) {
				return $template['name'] === $name && $template['language'] === $language;
			}
		);
		if ( ! $offered ) {
			return new WP_Error(
				'template_not_offered',
				__( 'This template is not an approved template without parameters in this language. Reload the templates and pick another. Nothing was sent.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		$recipient  = Client::normalize_recipient( $request->get_param( 'recipient' ) );
		$masked     = Client::mask_recipient( $recipient );
		$deliveries = new Deliveries();
		$delivery   = $deliveries->start(
			array(
				'origin'            => 'admin_test',
				'waba_id'           => $ids['waba_id'],
				'phone_number_id'   => $ids['phone_number_id'],
				'template_name'     => $name,
				'template_language' => $language,
				'recipient'         => $masked,
			)
		);
		if ( ! $delivery ) {
			return new WP_Error(
				'delivery_not_recorded',
				__( 'The send could not be recorded, so nothing was sent. Try again; if it keeps failing, check the site\'s database.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$result = $client->send_template( $ids['phone_number_id'], $recipient, $name, $language );
		// Best effort: a failure to store the result must not hide whether
		// WhatsApp accepted the message.
		$deliveries->finish( $delivery, $result );
		if ( ! $result['ok'] ) {
			$error = $this->remote_error( $result );
			$error->add_data( array_merge( $error->get_error_data(), array( 'recipient' => $masked ) ) );
			return $error;
		}
		return rest_ensure_response(
			array(
				'outcome'        => 'accepted',
				'message_status' => $result['message_status'],
				'recipient'      => $masked,
				'delivery_id'    => $delivery,
				'template'       => array(
					'name'     => $name,
					'language' => $language,
				),
			)
		);
	}

	/**
	 * The callback URL, webhook credential status and the verification and
	 * receipt that still apply.
	 *
	 * @return array
	 */
	private function webhook_status() {
		$state = Configuration::webhook();
		return array_merge(
			Connector::webhook_status(),
			array(
				'callback_url'      => WhatsAppWebhookController::callback_url(),
				'verified_at_local' => self::local_time( $state['verified_at'] ),
				'received_at_local' => self::local_time( $state['received_at'] ),
			)
		);
	}

	/**
	 * The REST shape of a delivery: allowlisted fields and translated
	 * explanations, never Meta's own text.
	 *
	 * @param array $row Delivery row.
	 * @return array
	 */
	public function present_delivery( array $row ) {
		$outcome = Deliveries::outcome( $row );
		$failure = null;
		if ( ! empty( $row['failed_at'] ) ) {
			$code    = (int) $row['failure_code'];
			$failure = array(
				'code'     => $code ? $code : null,
				'message'  => self::failure_message( $code ),
				'at_local' => self::local_time( $row['failed_at'] ),
			);
		}
		$send_error = null;
		if ( 'not_accepted' === $outcome ) {
			$send_error = array(
				'message'   => $this->message( (string) $row['send_error'] ),
				'meta_code' => null === $row['meta_code'] ? null : (int) $row['meta_code'],
			);
		}
		return array(
			'id'               => (int) $row['id'],
			'origin'           => (string) $row['origin'],
			'template'         => array(
				'name'     => (string) $row['template_name'],
				'language' => (string) $row['template_language'],
			),
			'recipient'        => (string) $row['recipient'],
			'outcome'          => $outcome,
			'pending'          => in_array( $outcome, array( 'accepted', 'sent' ), true ),
			'created_at_local' => self::local_time( $row['created_at'] ),
			'status_at_local'  => self::local_time( $row['status_at'] ),
			'failure'          => $failure,
			'send_error'       => $send_error,
		);
	}

	/**
	 * A stored UTC time in the site's date and time format.
	 *
	 * @param string|null $utc MySQL datetime in UTC.
	 * @return string|null
	 */
	private static function local_time( $utc ) {
		if ( ! $utc ) {
			return null;
		}
		return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $utc . ' UTC' ) );
	}

	/**
	 * What a delivery failure code means and what to do about it.
	 *
	 * @param int $code Allowlisted failure code, or 0.
	 * @return string
	 */
	private static function failure_message( $code ) {
		switch ( $code ) {
			case 131026:
				return __( 'WhatsApp could not deliver to this number. It may not use WhatsApp, or may run an outdated app.', 'fair-events-experimental' );
			case 131047:
				return __( 'More than 24 hours passed since the recipient last wrote, so only an approved template can reach them.', 'fair-events-experimental' );
			case 131049:
				return __( 'WhatsApp chose not to deliver this message to keep engagement healthy. Wait before sending this person another marketing message.', 'fair-events-experimental' );
			case 131050:
				return __( 'The recipient stopped marketing messages from this business.', 'fair-events-experimental' );
			case 131021:
				return __( 'The sender and the recipient are the same number.', 'fair-events-experimental' );
			case 130472:
				return __( 'WhatsApp held this message back as part of an experiment on the recipient\'s number.', 'fair-events-experimental' );
			case 131042:
				return __( 'The WhatsApp Business Account has a payment problem. Check its payment method in Meta Business Settings.', 'fair-events-experimental' );
			case 131031:
			case 368:
				return __( 'The WhatsApp Business Account is restricted or locked. Check its status in WhatsApp Manager.', 'fair-events-experimental' );
			case 131045:
			case 133010:
				return __( 'The sender phone number is not registered with the Cloud API. Register it in WhatsApp Manager.', 'fair-events-experimental' );
			case 4:
			case 130429:
			case 131048:
			case 131056:
				return __( 'Too many messages were sent too quickly. Wait before sending again.', 'fair-events-experimental' );
			case 131051:
			case 131052:
			case 131053:
				return __( 'WhatsApp could not process the message content.', 'fair-events-experimental' );
			case 132000:
			case 132001:
			case 132005:
			case 132007:
			case 132012:
			case 132015:
			case 132016:
				return __( 'The template is missing, paused or not approved in this language. Check it in WhatsApp Manager.', 'fair-events-experimental' );
			case 1:
			case 2:
			case 131000:
			case 131016:
				return __( 'WhatsApp had a temporary problem delivering the message. Try again later.', 'fair-events-experimental' );
			default:
				return __( 'WhatsApp reported that the message was not delivered.', 'fair-events-experimental' );
		}
	}

	/**
	 * Whether the token and IDs needed to contact Meta are in place.
	 *
	 * @param bool $validated Also require a validation of them.
	 * @return true|WP_Error
	 */
	private function ready( $validated = false ) {
		if ( ! Connector::status()['configured'] ) {
			return new WP_Error(
				'missing_token',
				__( 'Add a WhatsApp access token in Settings → Connectors first.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		$ids = Configuration::ids();
		if ( '' === $ids['waba_id'] || '' === $ids['phone_number_id'] ) {
			return new WP_Error(
				'missing_configuration',
				__( 'Save the WhatsApp Business Account ID and the Phone Number ID first.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		if ( $validated && ! Configuration::validation() ) {
			return new WP_Error(
				'not_validated',
				__( 'Validate the connection with the saved settings first.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}
		return true;
	}

	/**
	 * An actionable error for a failed {@see Client} result, carrying only
	 * allowlisted details.
	 *
	 * @param array $result Failed client result.
	 * @return WP_Error
	 */
	private function remote_error( array $result ) {
		$outcome = $result['outcome'] ?? '';
		$message = 'uncertain' === $outcome
			? __( 'WhatsApp did not confirm the message, so it may or may not have been sent. Ask the recipient before sending again; it was not retried.', 'fair-events-experimental' )
			: $this->message( $result['code'] );
		$status  = 'uncertain' === $outcome ? 502 : ( $result['temporary'] ? 503 : 400 );
		return new WP_Error(
			'whatsapp_' . $result['code'],
			$message,
			array(
				'status'    => $status,
				'reason'    => $result['code'],
				'outcome'   => $outcome,
				'temporary' => $result['temporary'],
				'meta_code' => $result['meta_code'],
				'trace_id'  => $result['trace_id'],
			)
		);
	}

	/**
	 * @param string $code Safe error code from {@see Client}.
	 * @return string What went wrong and how to fix it.
	 */
	private function message( $code ) {
		switch ( $code ) {
			case 'invalid_token':
				return __( 'Meta rejected the access token: it is invalid or has expired. Generate a new token and save it in Settings → Connectors.', 'fair-events-experimental' );
			case 'missing_permission':
				return __( 'The access token lacks the whatsapp_business_management or whatsapp_business_messaging permission, or access to this WhatsApp Business Account. Assign the account to the token\'s user and generate a new token.', 'fair-events-experimental' );
			case 'rate_limited':
				return __( 'Meta is limiting requests right now. Wait a few minutes and try again.', 'fair-events-experimental' );
			case 'waba_not_found':
				return __( 'Meta found no WhatsApp Business Account with this ID that the token can access. Check the WhatsApp Business Account ID and the token\'s access.', 'fair-events-experimental' );
			case 'phone_number_not_found':
				return __( 'Meta found no phone number with this Phone Number ID that the token can access. Copy the Phone Number ID from the App Dashboard or WhatsApp Manager; it is not the telephone number.', 'fair-events-experimental' );
			case 'phone_number_mismatch':
				return __( 'This Phone Number ID belongs to a different WhatsApp Business Account. Use two IDs from the same account.', 'fair-events-experimental' );
			case 'recipient_not_allowed':
				return __( 'The recipient is not on the sender\'s list of allowed numbers. A test sender can only message numbers added in the App Dashboard.', 'fair-events-experimental' );
			case 'recipient_unavailable':
				return __( 'WhatsApp cannot deliver to this recipient. Check that the number uses WhatsApp.', 'fair-events-experimental' );
			case 'sender_not_registered':
				return __( 'The sender phone number is not registered with the Cloud API. Register it in WhatsApp Manager.', 'fair-events-experimental' );
			case 'account_restricted':
				return __( 'The WhatsApp Business Account is restricted or locked. Check its status in WhatsApp Manager.', 'fair-events-experimental' );
			case 'payment_required':
				return __( 'The WhatsApp Business Account has a payment problem. Check its payment method in Meta Business Settings.', 'fair-events-experimental' );
			case 'template_unavailable':
				return __( 'Meta refused this template: it does not exist in this language or is not approved. Reload the templates and pick another.', 'fair-events-experimental' );
			case 'meta_unavailable':
				return __( 'Meta could not process the request. Try again later.', 'fair-events-experimental' );
			case 'transport':
				return __( 'Could not reach Meta. Check the site\'s outgoing connection and try again.', 'fair-events-experimental' );
			default:
				return __( 'Meta rejected the request. Check both IDs and the token\'s access, then try again.', 'fair-events-experimental' );
		}
	}
}
