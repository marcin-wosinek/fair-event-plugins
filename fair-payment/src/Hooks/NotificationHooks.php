<?php
/**
 * Notification hooks for Fair Payment
 *
 * Listens to fair_payment_paid and dispatches Telegram notifications asynchronously
 * via wp_schedule_single_event so the Mollie webhook is never blocked.
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

use FairPayment\Services\TelegramService;

defined( 'WPINC' ) || die;

/**
 * Wires Telegram notifications to successful-transaction events.
 */
class NotificationHooks {

	const CRON_HOOK = 'fair_payment_send_telegram_notification';

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		// Run after fair-audience handle_signup_paid (priority 10) so any
		// label/flip side effects are complete before we build the message.
		add_action( 'fair_payment_paid', array( $this, 'on_payment_paid' ), 20, 2 );
		add_action( self::CRON_HOOK, array( $this, 'dispatch_messages' ), 10, 1 );
	}

	/**
	 * Build the notification context and schedule async sending.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row.
	 * @return void
	 */
	public function on_payment_paid( $payment, $transaction ) {
		if ( ! get_option( 'fair_payment_telegram_enabled', false ) ) {
			return;
		}

		$bot_token = (string) get_option( 'fair_payment_telegram_bot_token', '' );
		$chat_ids  = $this->parse_chat_ids( (string) get_option( 'fair_payment_telegram_chat_ids', '' ) );

		if ( '' === $bot_token || empty( $chat_ids ) ) {
			return;
		}

		$context = $this->build_context( $payment, $transaction );

		$template    = (string) get_option( 'fair_payment_telegram_template', \FairPayment\Settings\Settings::default_template() );
		$include_pii = (bool) get_option( 'fair_payment_telegram_include_pii', true );

		$service = new TelegramService();
		$text    = $service->render_template( $template, $context, $include_pii );

		$payload = array(
			'bot_token' => $bot_token,
			'chat_ids'  => $chat_ids,
			'text'      => $text,
		);

		// Schedule for the next cron tick so the webhook response is not delayed
		// by Telegram API latency. Single-event hooks pass the args array as a
		// single positional argument (the array itself), hence the [ $payload ] wrapping.
		wp_schedule_single_event( time(), self::CRON_HOOK, array( $payload ) );
	}

	/**
	 * Cron handler — fans out the message to all configured chats.
	 *
	 * @param array $payload Payload with bot_token, chat_ids[], text.
	 * @return void
	 */
	public function dispatch_messages( $payload ) {
		if ( ! is_array( $payload ) || empty( $payload['chat_ids'] ) || empty( $payload['text'] ) ) {
			return;
		}

		$service   = new TelegramService();
		$bot_token = ! empty( $payload['bot_token'] ) ? $payload['bot_token'] : (string) get_option( 'fair_payment_telegram_bot_token', '' );

		foreach ( (array) $payload['chat_ids'] as $chat_id ) {
			$service->send( $bot_token, (string) $chat_id, (string) $payload['text'] );
		}
	}

	/**
	 * Parse the comma-separated chat IDs setting into a clean array.
	 *
	 * @param string $raw Raw setting value.
	 * @return string[]
	 */
	public static function parse_chat_ids( $raw ) {
		$parts = preg_split( '/[\s,]+/', (string) $raw );
		if ( ! is_array( $parts ) ) {
			return array();
		}
		return array_values( array_filter( array_map( 'trim', $parts ), 'strlen' ) );
	}

	/**
	 * Assemble the notification context for template rendering.
	 *
	 * Other plugins (fair-audience) hook `fair_payment_notification_context` to
	 * fill in participant/event details. Defaults degrade gracefully when no
	 * enrichment is available.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row.
	 * @return array
	 */
	public function build_context( $payment, $transaction ) {
		$amount   = isset( $transaction->amount ) ? $transaction->amount : null;
		$currency = isset( $transaction->currency ) ? $transaction->currency : '';
		$created  = isset( $transaction->created_at ) ? $transaction->created_at : '';
		$date     = '';
		if ( $created ) {
			$ts = strtotime( $created );
			if ( $ts ) {
				$date = gmdate( 'Y-m-d', $ts );
			}
		}

		$is_test = ! empty( $transaction->testmode );

		$base = array(
			'transaction'            => $transaction,
			'payment'                => $payment,
			'test_label'             => $is_test ? '[TEST] ' : '',
			'site_domain'            => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'amount'                 => null !== $amount ? number_format( (float) $amount, 2, '.', '' ) : '',
			'currency'               => $currency,
			'date'                   => $date,
			'transaction_id'         => isset( $transaction->id ) ? (string) $transaction->id : '',
			'event_title'            => '',
			'event_url'              => '',
			'participant_name'       => '',
			'participant_name_short' => '',
			'participant_url'        => '',
			'participant_email'      => '',
			'ticket_label'           => '',
			'activities'             => '',
			'discounts'              => '',
		);

		return apply_filters( 'fair_payment_notification_context', $base, $transaction, $payment );
	}

	/**
	 * Provide a sample context for the "Send test message" button.
	 *
	 * @return array
	 */
	public static function sample_context() {
		return array(
			'test_label'             => '[TEST] ',
			'site_domain'            => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'amount'                 => '10.00',
			'currency'               => 'EUR',
			'date'                   => gmdate( 'Y-m-d' ),
			'transaction_id'         => 'TEST-0001',
			'event_title'            => 'Sample Event',
			'event_url'              => admin_url( 'edit.php' ),
			'participant_name'       => 'Sample Participant',
			'participant_name_short' => 'Sample P.',
			'participant_url'        => admin_url( 'admin.php?page=fair-audience-participants' ),
			'participant_email'      => 'sample@example.com',
			'ticket_label'           => 'Regular',
			'activities'             => 'Sample Activity A, Sample Activity B',
			'discounts'              => 'Early bird -10%',
		);
	}
}
