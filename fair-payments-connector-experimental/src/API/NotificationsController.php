<?php
/**
 * Notifications REST controller
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

use FairPaymentsConnectorExperimental\Hooks\NotificationHooks;
use FairPaymentsConnectorExperimental\Services\TelegramService;
use FairPaymentsConnectorExperimental\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * REST endpoints for multi-channel notification settings.
 *
 * The notification routes are stored as an option and read/written through
 * /wp/v2/settings. This controller adds the "send test message" action that
 * exercises the configured channel against real infrastructure.
 *
 * Routes stay under fair-payments-connector/v1 for a stable base path.
 */
class NotificationsController extends \WP_REST_Controller {

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-payments-connector/v1',
			'/notifications/test',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'send_test_message' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'channel'     => array(
						'type'              => 'string',
						'required'          => true,
						'enum'              => array( 'email', 'telegram' ),
						'sanitize_callback' => 'sanitize_text_field',
					),
					'destination' => array(
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'include_pii' => array(
						'type'     => 'boolean',
						'required' => false,
						'default'  => true,
					),
				),
			)
		);
	}

	/**
	 * Send a test notification via the specified channel.
	 *
	 * @param \WP_REST_Request $request Incoming request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function send_test_message( $request ) {
		$channel     = (string) $request->get_param( 'channel' );
		$destination = trim( (string) $request->get_param( 'destination' ) );
		$include_pii = (bool) $request->get_param( 'include_pii' );

		if ( '' === $destination ) {
			return new \WP_Error(
				'fair_payment_notification_missing_destination',
				__( 'Destination is required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		if ( 'telegram' === $channel ) {
			$bot_token = (string) get_option( Settings::BOT_TOKEN_OPTION, '' );
			if ( '' === trim( $bot_token ) ) {
				return new \WP_Error(
					'fair_payment_telegram_missing_token',
					__( 'Telegram bot token is not configured.', 'fair-payments-connector-experimental' ),
					array( 'status' => 400 )
				);
			}
		}

		$service  = new TelegramService();
		$template = Settings::default_template();
		$text     = $service->render_template( $template, NotificationHooks::sample_context(), $include_pii );

		$channel_obj = NotificationHooks::make_channel( $channel );
		if ( null === $channel_obj ) {
			return new \WP_Error(
				'fair_payment_notification_unknown_channel',
				__( 'Unknown notification channel.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		$ok = $channel_obj->send( $destination, $text );

		if ( ! $ok ) {
			return new \WP_Error(
				'fair_payment_notification_test_failed',
				__( 'Test notification failed to send.', 'fair-payments-connector-experimental' ),
				array( 'status' => 502 )
			);
		}

		return new \WP_REST_Response(
			array(
				'success' => true,
				'message' => __( 'Test notification sent.', 'fair-payments-connector-experimental' ),
				'channel' => $channel,
				'text'    => $text,
			),
			200
		);
	}
}
