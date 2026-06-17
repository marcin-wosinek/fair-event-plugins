<?php
/**
 * Telegram settings REST controller
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

use FairPaymentsConnectorExperimental\Hooks\NotificationHooks;
use FairPaymentsConnectorExperimental\Services\TelegramService;
use FairPaymentsConnectorExperimental\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * REST endpoints for the Telegram notification settings.
 *
 * Settings themselves are stored as discrete options and read/written through
 * the standard `/wp/v2/settings` endpoint. This controller adds the one
 * operation that doesn't fit there: a "send test message" action that
 * exercises the bot token + chat IDs against the real Telegram API.
 *
 * Routes are registered under fair-payments-connector/v1 so TelegramTab.js
 * in fair-payments-connector does not need to change.
 */
class TelegramSettingsController extends \WP_REST_Controller {

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-payments-connector/v1',
			'/telegram/test',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'send_test_message' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'bot_token'   => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'chat_ids'    => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'template'    => array(
						'type'     => 'string',
						'required' => false,
					),
					'include_pii' => array(
						'type'     => 'boolean',
						'required' => false,
					),
				),
			)
		);
	}

	/**
	 * Send a test message to all configured (or supplied) chat IDs.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function send_test_message( $request ) {
		$bot_token = $request->get_param( 'bot_token' );
		if ( null === $bot_token || '' === $bot_token ) {
			$bot_token = (string) get_option( 'fair_payment_telegram_bot_token', '' );
		}

		$chat_ids_raw = $request->get_param( 'chat_ids' );
		if ( null === $chat_ids_raw || '' === $chat_ids_raw ) {
			$chat_ids_raw = (string) get_option( 'fair_payment_telegram_chat_ids', '' );
		}

		$template = $request->get_param( 'template' );
		if ( null === $template || '' === $template ) {
			$template = (string) get_option( 'fair_payment_telegram_template', Settings::default_template() );
		}

		$include_pii = $request->get_param( 'include_pii' );
		if ( null === $include_pii ) {
			$include_pii = (bool) get_option( 'fair_payment_telegram_include_pii', true );
		} else {
			$include_pii = (bool) $include_pii;
		}

		if ( '' === trim( (string) $bot_token ) ) {
			return new \WP_Error(
				'fair_payment_telegram_missing_token',
				__( 'Bot token is required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		$chat_ids = NotificationHooks::parse_chat_ids( (string) $chat_ids_raw );
		if ( empty( $chat_ids ) ) {
			return new \WP_Error(
				'fair_payment_telegram_missing_chat_id',
				__( 'At least one chat ID is required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		$service = new TelegramService();
		$text    = $service->render_template( (string) $template, NotificationHooks::sample_context(), (bool) $include_pii );

		$results = array();
		$any_ok  = false;
		$errors  = array();

		foreach ( $chat_ids as $chat_id ) {
			$response = $service->send( (string) $bot_token, $chat_id, $text );
			if ( is_wp_error( $response ) ) {
				$results[] = array(
					'chat_id' => $chat_id,
					'ok'      => false,
					'error'   => $response->get_error_message(),
				);
				$errors[]  = $chat_id . ': ' . $response->get_error_message();
			} else {
				$any_ok    = true;
				$results[] = array(
					'chat_id' => $chat_id,
					'ok'      => true,
				);
			}
		}

		if ( ! $any_ok ) {
			return new \WP_Error(
				'fair_payment_telegram_test_failed',
				__( 'Telegram test message failed for all chat IDs.', 'fair-payments-connector-experimental' ) . ' ' . implode( '; ', $errors ),
				array(
					'status'  => 502,
					'results' => $results,
				)
			);
		}

		return new \WP_REST_Response(
			array(
				'success' => true,
				'message' => __( 'Telegram test message sent.', 'fair-payments-connector-experimental' ),
				'results' => $results,
				'text'    => $text,
			),
			200
		);
	}
}
