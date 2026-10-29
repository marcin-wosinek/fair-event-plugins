<?php
/**
 * Minimal WhatsApp Cloud API client.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Talks to the WhatsApp Cloud API on Meta's fixed Graph API host: checks
 * that a phone number belongs to a WhatsApp Business Account, lists its
 * approved parameterless templates and sends one template.
 *
 * Every result is an allowlisted array. Meta's own error messages, raw
 * payloads, the access token and recipient numbers never leave this class;
 * a failure is reduced to a safe code, Meta's numeric error code and its
 * trace ID. Nothing is logged and nothing is retried.
 */
class Client {
	public const GRAPH_API_VERSION = 'v26.0';
	public const HOST              = 'https://graph.facebook.com/';

	/** Seconds to wait for Meta before giving up. */
	private const TIMEOUT = 15;

	/** Items requested per page of a Graph API list. */
	private const PAGE_SIZE = 100;

	/** Pages followed before a list is treated as complete. */
	private const MAX_PAGES = 20;

	/** Template component button types that take no parameters. */
	private const PLAIN_BUTTONS = array( 'QUICK_REPLY', 'PHONE_NUMBER', 'URL' );

	/**
	 * Access token.
	 *
	 * @var string
	 */
	private $token;

	/**
	 * Create a client for one access token.
	 *
	 * @param string $token Access token.
	 */
	public function __construct( $token ) {
		$this->token = (string) $token;
	}

	/**
	 * Check that the token can read the business account and that the phone
	 * number is one of its senders.
	 *
	 * @param string $waba_id         WhatsApp Business Account ID.
	 * @param string $phone_number_id Phone number ID.
	 * @return array `ok` with `sender` (`display_phone_number`, `verified_name`,
	 *     `quality_rating`), or a {@see self::failure()} result.
	 */
	public function validate( $waba_id, $phone_number_id ) {
		$account = $this->get( $waba_id, array( 'fields' => 'id,name' ) );
		if ( ! $account['ok'] ) {
			return $this->failure( $account, 'waba_not_found' );
		}

		$numbers = $this->get_all(
			$waba_id . '/phone_numbers',
			array( 'fields' => 'id,display_phone_number,verified_name,quality_rating' )
		);
		if ( ! $numbers['ok'] ) {
			return $this->failure( $numbers, 'waba_not_found' );
		}
		foreach ( $numbers['items'] as $number ) {
			if ( is_array( $number ) && (string) ( $number['id'] ?? '' ) === (string) $phone_number_id ) {
				return array(
					'ok'     => true,
					'sender' => array(
						'display_phone_number' => self::text( $number['display_phone_number'] ?? '' ),
						'verified_name'        => self::text( $number['verified_name'] ?? '' ),
						'quality_rating'       => self::text( $number['quality_rating'] ?? '' ),
					),
				);
			}
		}

		// Not one of the account's numbers: tell an ID of another account's
		// number apart from one the token cannot see at all.
		$number = $this->get( $phone_number_id, array( 'fields' => 'id' ) );
		if ( ! $number['ok'] ) {
			return $this->failure( $number, 'phone_number_not_found' );
		}
		return self::error( 'phone_number_mismatch' );
	}

	/**
	 * Approved templates of the account that take no parameters, sorted by
	 * name and language.
	 *
	 * @param string $waba_id WhatsApp Business Account ID.
	 * @return array `ok` with `templates` (`name`, `language`, `category`), or
	 *     a {@see self::failure()} result.
	 */
	public function templates( $waba_id ) {
		$list = $this->get_all(
			$waba_id . '/message_templates',
			array(
				'fields' => 'name,language,status,category,components',
				'status' => 'APPROVED',
			)
		);
		if ( ! $list['ok'] ) {
			return $this->failure( $list, 'waba_not_found' );
		}

		$templates = array();
		foreach ( $list['items'] as $template ) {
			if ( ! is_array( $template ) || 'APPROVED' !== ( $template['status'] ?? '' ) || ! self::parameterless( $template ) ) {
				continue;
			}
			$name     = (string) ( $template['name'] ?? '' );
			$language = (string) ( $template['language'] ?? '' );
			if ( ! self::valid_template_name( $name ) || ! self::valid_language( $language ) ) {
				continue;
			}
			$templates[] = array(
				'name'     => $name,
				'language' => $language,
				'category' => self::text( $template['category'] ?? '' ),
			);
		}
		usort(
			$templates,
			static function ( $a, $b ) {
				return array( $a['name'], $a['language'] ) <=> array( $b['name'], $b['language'] );
			}
		);

		return array(
			'ok'        => true,
			'templates' => $templates,
		);
	}

	/**
	 * Send one template message. Called once per explicit request; never
	 * retried, because a request that timed out may still have been sent.
	 *
	 * @param string $phone_number_id Sender's phone number ID.
	 * @param string $recipient       Recipient number, digits only.
	 * @param string $name            Template name.
	 * @param string $language        Template language code.
	 * @return array `ok` and `outcome`: 'accepted' with `message_id` and `message_status`,
	 *     'not_accepted' or 'uncertain' with the {@see self::failure()} fields.
	 */
	public function send_template( $phone_number_id, $recipient, $name, $language ) {
		$response = wp_remote_post(
			self::url( $phone_number_id . '/messages' ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $this->headers( array( 'Content-Type' => 'application/json' ) ),
				'body'    => wp_json_encode(
					array(
						'messaging_product' => 'whatsapp',
						'recipient_type'    => 'individual',
						'to'                => $recipient,
						'type'              => 'template',
						'template'          => array(
							'name'     => $name,
							'language' => array( 'code' => $language ),
						),
					)
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return array_merge( self::error( 'transport', true ), array( 'outcome' => 'uncertain' ) );
		}

		$answer = self::answer( $response );
		if ( $answer['ok'] ) {
			$message = $answer['data']['messages'][0] ?? null;
			if ( is_array( $message ) && self::valid_message_id( $message['id'] ?? null ) ) {
				return array(
					'ok'             => true,
					'outcome'        => 'accepted',
					'message_id'     => $message['id'],
					'message_status' => self::text( $message['message_status'] ?? '' ),
				);
			}
			return array_merge( self::error( 'unconfirmed', true ), array( 'outcome' => 'uncertain' ) );
		}

		$failure = $this->failure( $answer, 'phone_number_not_found' );
		// Meta failed on its side: the message may have gone out regardless.
		$failure['outcome'] = $answer['status'] >= 500 ? 'uncertain' : 'not_accepted';
		return $failure;
	}

	/**
	 * Recipient number reduced to its digits, or '' when it cannot be an
	 * international number.
	 *
	 * @param mixed $value Number as typed, such as "+34 600 123 456".
	 * @return string
	 */
	public static function normalize_recipient( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^\s*\+?[\d\s().-]+$/', $value ) ) {
			return '';
		}
		$digits = preg_replace( '/\D/', '', $value );
		return preg_match( '/^[1-9]\d{6,14}$/', $digits ) ? $digits : '';
	}

	/**
	 * A recipient number with all but its last three digits hidden.
	 *
	 * @param string $digits Number, digits only.
	 * @return string
	 */
	public static function mask_recipient( $digits ) {
		return str_repeat( '•', max( 0, strlen( $digits ) - 3 ) ) . substr( $digits, -3 );
	}

	/**
	 * Whether a value can be a WhatsApp message ID (a `wamid.` identifier).
	 *
	 * @param mixed $value Message ID.
	 * @return bool
	 */
	public static function valid_message_id( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^[A-Za-z0-9._=+\/:-]{1,191}$/', $value );
	}

	/**
	 * Whether a value can be a template name.
	 *
	 * @param mixed $value Template name.
	 * @return bool
	 */
	public static function valid_template_name( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^[a-z0-9_]{1,512}$/', $value );
	}

	/**
	 * Whether a value can be a template language code.
	 *
	 * @param mixed $value Template language code, such as en_US.
	 * @return bool
	 */
	public static function valid_language( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^[a-z]{2,3}(_[A-Za-z0-9]{2,8})?$/', $value );
	}

	/**
	 * Whether a template can be sent without parameters: no `{{n}}`
	 * placeholders, no media header and only buttons that take none.
	 *
	 * @param array $template Template as listed by Meta.
	 * @return bool
	 */
	public static function parameterless( array $template ) {
		if ( 'AUTHENTICATION' === ( $template['category'] ?? '' ) ) {
			return false;
		}
		foreach ( (array) ( $template['components'] ?? array() ) as $component ) {
			if ( ! is_array( $component ) ) {
				return false;
			}
			$type = strtoupper( (string) ( $component['type'] ?? '' ) );
			if ( 'HEADER' === $type && 'TEXT' !== strtoupper( (string) ( $component['format'] ?? 'TEXT' ) ) ) {
				return false;
			}
			if ( false !== strpos( (string) ( $component['text'] ?? '' ), '{{' ) ) {
				return false;
			}
			if ( 'BUTTONS' === $type ) {
				foreach ( (array) ( $component['buttons'] ?? array() ) as $button ) {
					if (
						! is_array( $button )
						|| ! in_array( strtoupper( (string) ( $button['type'] ?? '' ) ), self::PLAIN_BUTTONS, true )
						|| false !== strpos( (string) ( $button['url'] ?? '' ), '{{' )
					) {
						return false;
					}
				}
			}
		}
		return true;
	}

	/**
	 * GET one Graph API object or edge page.
	 *
	 * @param string $path  Path after the API version.
	 * @param array  $query Query arguments.
	 * @return array {@see self::answer()} result, or a transport failure.
	 */
	private function get( $path, array $query ) {
		$response = wp_remote_get(
			self::url( $path, $query ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $this->headers(),
			)
		);
		if ( is_wp_error( $response ) ) {
			return array(
				'ok'        => false,
				'transport' => true,
				'status'    => 0,
				'data'      => null,
			);
		}
		return self::answer( $response );
	}

	/**
	 * Every item of a Graph API edge, following its `after` cursor on the
	 * fixed host rather than the `next` URL Meta returns.
	 *
	 * @param string $path  Edge path.
	 * @param array  $query Query arguments.
	 * @return array `ok` with `items`, or the failing page's answer.
	 */
	private function get_all( $path, array $query ) {
		$items = array();
		$query = array_merge( $query, array( 'limit' => self::PAGE_SIZE ) );
		for ( $page = 0; $page < self::MAX_PAGES; $page++ ) {
			$answer = $this->get( $path, $query );
			if ( ! $answer['ok'] ) {
				return $answer;
			}
			$items = array_merge( $items, is_array( $answer['data']['data'] ?? null ) ? $answer['data']['data'] : array() );
			$after = $answer['data']['paging']['cursors']['after'] ?? '';
			if ( empty( $answer['data']['paging']['next'] ) || ! is_string( $after ) || '' === $after ) {
				break;
			}
			$query['after'] = $after;
		}
		return array(
			'ok'    => true,
			'items' => $items,
		);
	}

	/**
	 * Request headers carrying the token.
	 *
	 * @param array $extra Additional headers.
	 * @return array Request headers carrying the token.
	 */
	private function headers( array $extra = array() ) {
		return array_merge( array( 'Authorization' => 'Bearer ' . $this->token ), $extra );
	}

	/**
	 * A URL on Meta's fixed host.
	 *
	 * @param string $path  Path after the API version.
	 * @param array  $query Query arguments.
	 * @return string URL on Meta's fixed host.
	 */
	private static function url( $path, array $query = array() ) {
		$segments = array_map( 'rawurlencode', explode( '/', $path ) );
		$url      = self::HOST . self::GRAPH_API_VERSION . '/' . implode( '/', $segments );
		return $query ? $url . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) : $url;
	}

	/**
	 * Decode a Graph API response.
	 *
	 * @param array $response {@see wp_remote_request()} response.
	 * @return array `ok` (2xx with a JSON object), `status` and decoded `data`.
	 */
	private static function answer( $response ) {
		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = json_decode( wp_remote_retrieve_body( $response ), true );
		$data   = is_array( $data ) ? $data : null;
		return array(
			'ok'        => $status >= 200 && $status < 300 && null !== $data,
			'transport' => false,
			'status'    => $status,
			'data'      => $data,
		);
	}

	/**
	 * Reduce a failed answer to a safe code.
	 *
	 * @param array  $answer    Failed {@see self::answer()} result.
	 * @param string $not_found Code for an ID that does not exist or that the
	 *                          token cannot see.
	 * @return array `ok` false, `code`, `temporary`, `meta_code` and `trace_id`.
	 */
	private function failure( array $answer, $not_found ) {
		if ( ! empty( $answer['transport'] ) ) {
			return self::error( 'transport', true );
		}
		$error = is_array( $answer['data']['error'] ?? null ) ? $answer['data']['error'] : array();
		$code  = (int) ( $error['code'] ?? 0 );
		$sub   = (int) ( $error['error_subcode'] ?? 0 );
		$trace = (string) ( $error['fbtrace_id'] ?? '' );
		$trace = preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $trace ) ? $trace : '';
		$meta  = $code ? $code : null;

		if ( 190 === $code ) {
			return self::error( 'invalid_token', false, $meta, $trace );
		}
		if ( 10 === $code || ( $code >= 200 && $code <= 299 ) ) {
			return self::error( 'missing_permission', false, $meta, $trace );
		}
		if ( 429 === $answer['status'] || in_array( $code, array( 4, 17, 32, 613, 80007, 130429, 131048, 131056 ), true ) ) {
			return self::error( 'rate_limited', true, $meta, $trace );
		}
		if ( 100 === $code && 33 === $sub ) {
			return self::error( $not_found, false, $meta, $trace );
		}
		$known = array(
			131030 => 'recipient_not_allowed',
			131026 => 'recipient_unavailable',
			133010 => 'sender_not_registered',
			131031 => 'account_restricted',
			368    => 'account_restricted',
			131042 => 'payment_required',
			132000 => 'template_unavailable',
			132001 => 'template_unavailable',
			132005 => 'template_unavailable',
			132007 => 'template_unavailable',
			132012 => 'template_unavailable',
			132015 => 'template_unavailable',
			132016 => 'template_unavailable',
		);
		if ( isset( $known[ $code ] ) ) {
			return self::error( $known[ $code ], false, $meta, $trace );
		}
		if ( $answer['status'] >= 500 || in_array( $code, array( 1, 2, 131000 ), true ) ) {
			return self::error( 'meta_unavailable', true, $meta, $trace );
		}
		if ( $answer['status'] >= 200 && $answer['status'] < 300 ) {
			return self::error( 'unexpected_response', true, $meta, $trace );
		}
		return self::error( 'rejected', false, $meta, $trace );
	}

	/**
	 * Build a failure result.
	 *
	 * @param string   $code      Safe error code.
	 * @param bool     $temporary Whether trying again later may succeed.
	 * @param int|null $meta_code Meta's numeric error code.
	 * @param string   $trace_id  Meta's trace ID.
	 * @return array Failure result.
	 */
	private static function error( $code, $temporary = false, $meta_code = null, $trace_id = '' ) {
		return array(
			'ok'        => false,
			'code'      => $code,
			'temporary' => $temporary,
			'meta_code' => $meta_code,
			'trace_id'  => $trace_id,
		);
	}

	/**
	 * Plain text for a display value from Meta.
	 *
	 * @param mixed $value Display value from Meta.
	 * @return string Plain text of at most 200 characters.
	 */
	private static function text( $value ) {
		return is_scalar( $value ) ? mb_substr( sanitize_text_field( (string) $value ), 0, 200 ) : '';
	}
}
