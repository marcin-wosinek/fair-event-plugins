<?php
/**
 * Instagram Graph API publishing calls for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

defined( 'WPINC' ) || die;

/**
 * The publishing steps of the Instagram API with Unified Login, one request
 * each: create a media container, read its processing status, publish it,
 * and read the published post's link.
 *
 * Nothing here waits, retries or decides what happens next: the caller
 * persists each step's outcome and schedules the next one, so a request
 * that stops midway never leaves a post published twice. Every result says
 * whether Instagram may have acted on the request:
 *
 * - 'ok' / 'sent': Instagram answered and did it.
 * - 'failed': Instagram answered and refused it; nothing changed there.
 * - 'uncertain': no usable answer (a transport error, a server error or an
 *   unknown error), so it may have happened.
 *
 * The token travels in an Authorization header, never in a URL, and every
 * message returned has it removed. Requests never follow redirects.
 */
class GraphClient {

	/**
	 * Meta error codes that do not say whether the request was carried out:
	 * unknown error (1) and service temporarily unavailable (2).
	 */
	const UNCERTAIN_ERROR_CODES = array( 1, 2 );

	/**
	 * Longest message returned, in characters.
	 */
	const MAX_MESSAGE = 200;

	/**
	 * Access token.
	 *
	 * @var string
	 */
	private $token;

	/**
	 * Instagram account ID.
	 *
	 * @var string
	 */
	private $account;

	/**
	 * Graph API base URL, with its version.
	 *
	 * @var string
	 */
	private $base;

	/**
	 * Constructor.
	 *
	 * @param string $token   Access token.
	 * @param string $account Instagram account ID.
	 * @param string $base    Graph API base URL, with its version.
	 */
	public function __construct( $token, $account, $base ) {
		$this->token   = (string) $token;
		$this->account = (string) $account;
		$this->base    = rtrim( (string) $base, '/' );
	}

	/**
	 * A client for the stored connection.
	 *
	 * @return self
	 */
	public static function from_connection() {
		return new self( Connection::access_token(), Connection::user_id(), Connection::graph_base() );
	}

	/**
	 * Create an image container. Nothing is published yet.
	 *
	 * @param string $image_url Public JPEG URL Instagram downloads.
	 * @param string $caption   Caption.
	 * @return array{state: string, id: string, code: string, message: string}
	 */
	public function create_container( $image_url, $caption ) {
		$response = wp_remote_post(
			$this->base . '/' . rawurlencode( $this->account ) . '/media',
			$this->args(
				60,
				array(
					'image_url' => (string) $image_url,
					'caption'   => (string) $caption,
				)
			)
		);

		$result = $this->interpret( $response );
		if ( 'ok' === $result['state'] && '' === $result['id'] ) {
			return self::result( 'failed', '', 'invalid_response', __( 'Instagram did not return a container ID.', 'fair-events-experimental' ) );
		}
		// A container that may exist is never published, so an uncertain
		// creation is a failure: nothing was posted.
		if ( 'uncertain' === $result['state'] ) {
			$result['state'] = 'failed';
		}
		return $result;
	}

	/**
	 * A container's processing status.
	 *
	 * @param string $container_id Container ID.
	 * @return array{state: string, status_code: string, code: string, message: string}
	 *     `status_code` is Instagram's: IN_PROGRESS, FINISHED, PUBLISHED, ERROR or EXPIRED.
	 */
	public function container_status( $container_id ) {
		$response = wp_remote_get(
			$this->base . '/' . rawurlencode( (string) $container_id ) . '?fields=status_code',
			$this->args( 30 )
		);

		$result                = $this->interpret( $response );
		$data                  = $this->decode( $response );
		$result['status_code'] = 'ok' === $result['state'] && isset( $data['status_code'] ) && is_string( $data['status_code'] )
			? strtoupper( $data['status_code'] )
			: '';
		if ( 'ok' === $result['state'] && '' === $result['status_code'] ) {
			$result['state'] = 'uncertain';
			$result['code']  = 'invalid_response';
		}
		unset( $result['id'] );
		return $result;
	}

	/**
	 * Publish a finished container. This makes the post public.
	 *
	 * @param string $container_id Container ID.
	 * @return array{state: string, id: string, code: string, message: string}
	 *     State 'sent' with the media ID, 'failed' or 'uncertain'.
	 */
	public function publish( $container_id ) {
		$response = wp_remote_post(
			$this->base . '/' . rawurlencode( $this->account ) . '/media_publish',
			$this->args( 60, array( 'creation_id' => (string) $container_id ) )
		);

		$result = $this->interpret( $response );
		if ( 'ok' === $result['state'] ) {
			// Instagram said it worked but gave no media ID: it may be public.
			$result['state'] = '' !== $result['id'] ? 'sent' : 'uncertain';
			$result['code']  = '' !== $result['id'] ? '' : 'invalid_response';
		}
		return $result;
	}

	/**
	 * A published post's public link.
	 *
	 * @param string $media_id Media ID.
	 * @return string '' when it cannot be read.
	 */
	public function permalink( $media_id ) {
		$response = wp_remote_get(
			$this->base . '/' . rawurlencode( (string) $media_id ) . '?fields=permalink',
			$this->args( 30 )
		);
		if ( 'ok' !== $this->interpret( $response )['state'] ) {
			return '';
		}
		$data = $this->decode( $response );
		$link = isset( $data['permalink'] ) && is_string( $data['permalink'] ) ? $data['permalink'] : '';

		return preg_match( '#^https://(www\.)?instagram\.com/[^\s]*$#', $link ) ? $link : '';
	}

	/**
	 * Request arguments.
	 *
	 * @param int        $timeout Seconds.
	 * @param array|null $body    POST body.
	 * @return array
	 */
	private function args( $timeout, $body = null ) {
		$args = array(
			'timeout'     => $timeout,
			'redirection' => 0,
			'headers'     => array( 'Authorization' => 'Bearer ' . $this->token ),
		);
		if ( null !== $body ) {
			$args['body'] = $body;
		}
		return $args;
	}

	/**
	 * Classify a response.
	 *
	 * @param array|\WP_Error $response HTTP response.
	 * @return array{state: string, id: string, code: string, message: string}
	 */
	private function interpret( $response ) {
		if ( is_wp_error( $response ) ) {
			return self::result( 'uncertain', '', 'transport_error', $this->clean( $response->get_error_message() ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = $this->decode( $response );

		if ( isset( $data['error'] ) && is_array( $data['error'] ) ) {
			$error   = $data['error'];
			$code    = isset( $error['code'] ) ? (int) $error['code'] : 0;
			$message = $error['error_user_msg'] ?? ( $error['message'] ?? '' );
			$state   = $status >= 500 || in_array( $code, self::UNCERTAIN_ERROR_CODES, true ) || ! empty( $error['is_transient'] )
				? 'uncertain'
				: 'failed';
			return self::result( $state, '', 'meta_' . $code, $this->clean( is_string( $message ) ? $message : '' ) );
		}

		if ( $status >= 200 && $status < 300 && is_array( $data ) ) {
			return self::result( 'ok', isset( $data['id'] ) && is_scalar( $data['id'] ) ? (string) $data['id'] : '', '', '' );
		}

		return self::result( $status >= 500 || 0 === $status || null === $data ? 'uncertain' : 'failed', '', 'http_' . $status, '' );
	}

	/**
	 * Decoded JSON body.
	 *
	 * @param array|\WP_Error $response HTTP response.
	 * @return array|null
	 */
	private function decode( $response ) {
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return is_array( $data ) ? $data : null;
	}

	/**
	 * A message from Meta or the transport without the token, shortened.
	 *
	 * @param string $message Message.
	 * @return string
	 */
	private function clean( $message ) {
		return mb_substr( Connection::redact( (string) $message, $this->token ), 0, self::MAX_MESSAGE );
	}

	/**
	 * Build a result.
	 *
	 * @param string $state   State.
	 * @param string $id      ID Instagram returned.
	 * @param string $code    Safe code.
	 * @param string $message Safe message.
	 * @return array{state: string, id: string, code: string, message: string}
	 */
	private static function result( $state, $id, $code, $message ) {
		return array(
			'state'   => $state,
			'id'      => $id,
			'code'    => $code,
			'message' => $message,
		);
	}
}
