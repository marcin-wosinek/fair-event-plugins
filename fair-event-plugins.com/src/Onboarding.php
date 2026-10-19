<?php
/**
 * Stripe Connect hosted onboarding endpoints.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom;

use Stripe\Exception\ApiErrorException;
use Stripe\Exception\InvalidRequestException;

/**
 * Request handling for account.php and account_link.php.
 *
 * Every outcome is a JsonResponse: provider and configuration details go to
 * the server log, responses carry only a generic `error` message.
 */
class Onboarding {

	/**
	 * Connected account ID format.
	 */
	const ACCOUNT_ID_PATTERN = '/^acct_[A-Za-z0-9]{1,64}$/';

	/**
	 * Create a connected account. Returns `{ account }`.
	 *
	 * @param string $method HTTP request method.
	 * @param Config $config Server configuration.
	 * @return JsonResponse
	 */
	public static function create_account( string $method, Config $config ): JsonResponse {
		if ( 'POST' !== $method ) {
			return self::method_not_allowed();
		}

		return self::guard(
			'create an account',
			function () use ( $config ) {
				$account = $config->stripe_client()->accounts->create();

				return new JsonResponse( 200, array( 'account' => $account->id ) );
			}
		);
	}

	/**
	 * Create an onboarding link for a connected account. Returns `{ url }`.
	 *
	 * @param string $method HTTP request method.
	 * @param string $body   Raw JSON request body: `{ "account": "acct_…" }`.
	 * @param Config $config Server configuration.
	 * @return JsonResponse
	 */
	public static function create_account_link( string $method, string $body, Config $config ): JsonResponse {
		if ( 'POST' !== $method ) {
			return self::method_not_allowed();
		}

		$data = json_decode( $body, true );
		if ( ! is_array( $data ) ) {
			return JsonResponse::error( 400, 'The request body must be a JSON object.' );
		}

		$account = $data['account'] ?? null;
		if ( ! is_string( $account ) || ! preg_match( self::ACCOUNT_ID_PATTERN, $account ) ) {
			return JsonResponse::error( 400, 'A valid connected account ID is required.' );
		}

		return self::guard(
			'create an account link',
			function () use ( $config, $account ) {
				$base = $config->site_base_url();
				$link = $config->stripe_client()->accountLinks->create(
					array(
						'account'     => $account,
						'return_url'  => $base . '/return/' . $account,
						'refresh_url' => $base . '/refresh/' . $account,
						'type'        => 'account_onboarding',
					)
				);

				return new JsonResponse( 200, array( 'url' => $link->url ) );
			}
		);
	}

	/**
	 * Run a provider call, converting failures into generic JSON errors.
	 *
	 * @param string   $action   Log description of the call.
	 * @param callable $callback Returns the success response.
	 * @return JsonResponse
	 */
	private static function guard( string $action, callable $callback ): JsonResponse {
		try {
			return $callback();
		} catch ( ConfigurationException $e ) {
			self::log( "Cannot {$action}: {$e->getMessage()}" );
			return JsonResponse::error( 500, 'Payment setup is temporarily unavailable.' );
		} catch ( InvalidRequestException $e ) {
			self::log_provider_error( $action, $e );
			if ( 'resource_missing' === $e->getStripeCode() ) {
				return JsonResponse::error( 404, 'The connected account was not found.' );
			}
			return JsonResponse::error( 502, 'The payment provider could not complete the request.' );
		} catch ( ApiErrorException $e ) {
			self::log_provider_error( $action, $e );
			return JsonResponse::error( 502, 'The payment provider could not complete the request.' );
		} catch ( \Throwable $e ) {
			self::log( 'Unexpected error when trying to ' . $action . ': ' . get_class( $e ) );
			return JsonResponse::error( 500, 'Payment setup is temporarily unavailable.' );
		}
	}

	/**
	 * 405 response for anything but POST.
	 *
	 * @return JsonResponse
	 */
	private static function method_not_allowed(): JsonResponse {
		return new JsonResponse( 405, array( 'error' => 'Use POST.' ), array( 'Allow' => 'POST' ) );
	}

	/**
	 * Log a Stripe API error with its request ID.
	 *
	 * @param string            $action Log description of the call.
	 * @param ApiErrorException $e      Provider error.
	 */
	private static function log_provider_error( string $action, ApiErrorException $e ): void {
		self::log(
			sprintf(
				'Stripe API error when trying to %s: %s (HTTP %s, code %s, request %s): %s',
				$action,
				get_class( $e ),
				$e->getHttpStatus() ?? 'n/a',
				$e->getStripeCode() ?? 'n/a',
				$e->getRequestId() ?? 'n/a',
				$e->getMessage()
			)
		);
	}

	/**
	 * Write a server log line.
	 *
	 * @param string $message Log message.
	 */
	private static function log( string $message ): void {
		error_log( $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Not a WordPress runtime; provider failures belong in the server log.
	}
}
