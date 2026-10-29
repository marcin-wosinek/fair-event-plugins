<?php
/**
 * Public WhatsApp webhook for Meta's callbacks.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\WhatsApp\Configuration;
use FairEventsExperimental\WhatsApp\Connector;
use FairEventsExperimental\WhatsApp\Deliveries;
use FairEventsExperimental\WhatsApp\Webhook;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/**
 * GET answers Meta's verification challenge; POST receives delivery status
 * updates and incoming messages.
 *
 * Both routes are public because Meta calls them without a WordPress login.
 * GET is authenticated by the verify token, POST by an HMAC of the raw body
 * with the App Secret; nothing is read or stored before that check passes,
 * and only entries for the saved account and number are applied. Responses
 * never echo the request beyond the validated challenge.
 */
class WhatsAppWebhookController extends WP_REST_Controller {
	public const ROUTE = '/whatsapp/webhook';

	protected $namespace = 'fair-events-experimental/v1';

	/** Register routes. */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			self::ROUTE,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'verify' ),
					// Public: Meta verifies the URL anonymously; the callback checks the verify token.
					'permission_callback' => '__return_true',
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'receive' ),
					// Public: Meta posts anonymously; the callback checks the body's signature.
					'permission_callback' => '__return_true',
				),
			)
		);
		add_filter( 'rest_pre_serve_request', array( $this, 'serve_challenge' ), 10, 4 );
	}

	/** @return string Full callback URL to enter in the App Dashboard. */
	public static function callback_url() {
		return rest_url( 'fair-events-experimental/v1' . self::ROUTE );
	}

	/**
	 * Answer Meta's subscription check with the challenge when the verify
	 * token matches.
	 *
	 * PHP turns the `hub.mode` query parameter into `hub_mode`, so both
	 * spellings are read.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function verify( $request ) {
		$mode      = self::hub_param( $request, 'mode' );
		$token     = self::hub_param( $request, 'verify_token' );
		$challenge = self::hub_param( $request, 'challenge' );
		$expected  = Connector::webhook_credential( 'verify_token' )['token'];

		if (
			'' === $expected
			|| 'subscribe' !== $mode
			|| ! is_string( $token )
			|| ! hash_equals( $expected, $token )
			|| ! is_string( $challenge )
			|| ! preg_match( '/^[A-Za-z0-9_-]{1,128}$/', $challenge )
		) {
			return new WP_Error( 'whatsapp_verification_failed', __( 'Webhook verification failed.', 'fair-events-experimental' ), array( 'status' => 403 ) );
		}

		Configuration::record_webhook_verification();
		return new WP_REST_Response( $challenge, 200 );
	}

	/**
	 * Send a successful verification as the bare challenge, which Meta
	 * expects instead of JSON.
	 *
	 * @param bool                   $served  Whether the request was served.
	 * @param WP_REST_Response|mixed $result  Response.
	 * @param \WP_REST_Request       $request Request.
	 * @return bool
	 */
	public function serve_challenge( $served, $result, $request ) {
		if (
			$served
			|| 'GET' !== $request->get_method()
			|| '/' . $this->namespace . self::ROUTE !== $request->get_route()
			|| ! $result instanceof WP_REST_Response
			|| 200 !== $result->get_status()
			|| ! is_string( $result->get_data() )
		) {
			return $served;
		}
		if ( ! headers_sent() ) {
			header( 'Content-Type: text/plain; charset=utf-8' );
		}
		// The challenge was validated as [A-Za-z0-9_-] in verify().
		echo esc_html( $result->get_data() );
		return true;
	}

	/**
	 * Apply a signed callback: status updates for this site's sends and
	 * incoming messages for the opt-out hook.
	 *
	 * Unsupported, duplicate and other-account updates are acknowledged with
	 * 200 so Meta stops resending them. A storage or consumer failure
	 * answers 500, so Meta retries the whole batch; repeating it is safe.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function receive( $request ) {
		$secret = Connector::webhook_credential( 'app_secret' )['token'];
		if ( '' === $secret ) {
			return new WP_Error( 'whatsapp_webhook_not_configured', __( 'The WhatsApp webhook is not configured.', 'fair-events-experimental' ), array( 'status' => 503 ) );
		}
		$raw = (string) $request->get_body();
		if ( strlen( $raw ) > Webhook::MAX_BYTES ) {
			return new WP_Error( 'whatsapp_webhook_too_large', __( 'The callback is too large.', 'fair-events-experimental' ), array( 'status' => 413 ) );
		}
		if ( ! Webhook::valid_signature( $raw, $request->get_header( 'x-hub-signature-256' ), $secret ) ) {
			return new WP_Error( 'whatsapp_invalid_signature', __( 'The callback signature is missing or invalid.', 'fair-events-experimental' ), array( 'status' => 401 ) );
		}

		$ids    = Configuration::ids();
		$parsed = Webhook::parse( json_decode( $raw, true ), $ids['waba_id'], $ids['phone_number_id'] );
		if ( null === $parsed ) {
			return new WP_Error( 'whatsapp_invalid_callback', __( 'The callback is not a WhatsApp Business Account update.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}

		$failed     = false;
		$deliveries = new Deliveries();
		foreach ( $parsed['statuses'] as $status ) {
			if ( ! $deliveries->apply_status( $ids['phone_number_id'], $status['message_id'], $status['status'], $status['timestamp'], $status['failure_code'] ) ) {
				$failed = true;
			}
		}
		foreach ( $parsed['messages'] as $message ) {
			try {
				/**
				 * An authenticated incoming WhatsApp message for the saved
				 * account, for an opt-out handler. Runs synchronously, at
				 * least once: Meta resends a callback this site failed to
				 * acknowledge, so deduplicate by `id`. Neither the message
				 * nor its text is stored or logged by this plugin.
				 *
				 * @param array $message `id`, `from` (digits), `timestamp`,
				 *                       `type`, `text` (string or null),
				 *                       `waba_id` and `phone_number_id`.
				 */
				do_action( Webhook::INCOMING_HOOK, $message );
			} catch ( \Throwable $e ) {
				$failed = true;
			}
		}
		if ( $failed ) {
			return new WP_Error( 'whatsapp_webhook_storage_failed', __( 'The callback could not be stored. Meta will send it again.', 'fair-events-experimental' ), array( 'status' => 500 ) );
		}

		if ( $parsed['matched'] > 0 ) {
			Configuration::record_webhook_receipt();
		}
		return new WP_REST_Response(
			array(
				'matched' => $parsed['matched'],
				'ignored' => $parsed['ignored'],
			),
			200
		);
	}

	/**
	 * A `hub.*` query parameter, under either spelling.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @param string           $name    Name after `hub.`.
	 * @return mixed
	 */
	private static function hub_param( $request, $name ) {
		$query = $request->get_query_params();
		return $query[ 'hub_' . $name ] ?? $query[ 'hub.' . $name ] ?? null;
	}
}
