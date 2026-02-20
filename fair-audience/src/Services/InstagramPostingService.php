<?php
/**
 * Instagram Posting Service
 *
 * Handles posting images to Instagram via Graph API.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Models\InstagramPost;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Service for posting to Instagram.
 */
class InstagramPostingService {

	/**
	 * Instagram Graph API version.
	 *
	 * @var string
	 */
	private const API_VERSION = 'v24.0';

	/**
	 * Get the Instagram user ID.
	 *
	 * @return string|null Instagram user ID or null if not configured.
	 */
	private function get_user_id() {
		return get_option( 'fair_audience_instagram_user_id', '' ) ?: null;
	}

	/**
	 * Get the Instagram access token.
	 *
	 * @return string|null Access token or null if not configured.
	 */
	private function get_access_token() {
		return get_option( 'fair_audience_instagram_access_token', '' ) ?: null;
	}

	/**
	 * Check if Instagram is properly configured.
	 *
	 * @return bool|WP_Error True if configured, WP_Error otherwise.
	 */
	public function is_configured() {
		$user_id      = $this->get_user_id();
		$access_token = $this->get_access_token();

		if ( empty( $user_id ) ) {
			return new WP_Error(
				'instagram_not_configured',
				__( 'Instagram user ID is not configured. Please connect your Instagram account in Settings.', 'fair-audience' )
			);
		}

		if ( empty( $access_token ) ) {
			return new WP_Error(
				'instagram_not_configured',
				__( 'Instagram access token is not configured. Please connect your Instagram account in Settings.', 'fair-audience' )
			);
		}

		return true;
	}

	/**
	 * Create and publish an Instagram post.
	 *
	 * This is a two-step process:
	 * 1. Create a media container
	 * 2. Publish the container
	 *
	 * @param InstagramPost $post The post to publish.
	 * @return InstagramPost|WP_Error Updated post or error.
	 */
	public function publish( InstagramPost $post ) {
		$configured = $this->is_configured();
		if ( is_wp_error( $configured ) ) {
			return $configured;
		}

		$user_id      = $this->get_user_id();
		$access_token = $this->get_access_token();

		// Update status to publishing.
		$post->status = 'publishing';
		$post->save();

		// Step 1: Create media container.
		$container_result = $this->create_media_container( $user_id, $access_token, $post->image_url, $post->caption );

		if ( is_wp_error( $container_result ) ) {
			$post->status        = 'failed';
			$post->error_message = $container_result->get_error_message();
			$post->save();
			return $container_result;
		}

		$post->ig_container_id = $container_result['id'];
		$post->save();

		// Step 2: Publish the container.
		$publish_result = $this->publish_container( $user_id, $access_token, $container_result['id'] );

		if ( is_wp_error( $publish_result ) ) {
			$post->status        = 'failed';
			$post->error_message = $publish_result->get_error_message();
			$post->save();
			return $publish_result;
		}

		// Success!
		$post->ig_media_id  = $publish_result['id'];
		$post->status       = 'published';
		$post->published_at = current_time( 'mysql' );

		// Fetch permalink (non-critical).
		$permalink = $this->fetch_permalink( $access_token, $publish_result['id'] );
		if ( $permalink ) {
			$post->permalink = $permalink;
		}

		$post->save();

		return $post;
	}

	/**
	 * Create a media container on Instagram.
	 *
	 * @param string $user_id      Instagram user ID.
	 * @param string $access_token Access token.
	 * @param string $image_url    Publicly accessible image URL.
	 * @param string $caption      Post caption.
	 * @return array|WP_Error Response data or error.
	 */
	private function create_media_container( $user_id, $access_token, $image_url, $caption ) {
		$url = sprintf(
			'https://graph.facebook.com/%s/%s/media',
			self::API_VERSION,
			$user_id
		);

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 60,
				'body'    => array(
					'image_url'    => $image_url,
					'caption'      => $caption,
					'access_token' => $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_error',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to connect to Instagram API: %s', 'fair-audience' ),
					$response->get_error_message()
				)
			);
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( isset( $data['error'] ) ) {
			$error_message = $data['error']['message'] ?? __( 'Unknown error', 'fair-audience' );
			return new WP_Error(
				'instagram_error',
				sprintf(
					/* translators: %s: error message */
					__( 'Instagram API error: %s', 'fair-audience' ),
					$error_message
				)
			);
		}

		if ( empty( $data['id'] ) ) {
			return new WP_Error(
				'invalid_response',
				__( 'Invalid response from Instagram API: no container ID returned.', 'fair-audience' )
			);
		}

		return $data;
	}

	/**
	 * Fetch the permalink for a published Instagram media.
	 *
	 * @param string $access_token Access token.
	 * @param string $media_id     Instagram media ID.
	 * @return string|null Permalink URL or null on failure.
	 */
	private function fetch_permalink( $access_token, $media_id ) {
		$url = sprintf(
			'https://graph.facebook.com/%s/%s?fields=permalink&access_token=%s',
			self::API_VERSION,
			$media_id,
			$access_token
		);

		$response = wp_remote_get(
			$url,
			array( 'timeout' => 30 )
		);

		if ( is_wp_error( $response ) ) {
			return null;
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( ! empty( $data['permalink'] ) ) {
			return $data['permalink'];
		}

		return null;
	}

	/**
	 * Publish a media container.
	 *
	 * @param string $user_id      Instagram user ID.
	 * @param string $access_token Access token.
	 * @param string $container_id Container ID from step 1.
	 * @return array|WP_Error Response data or error.
	 */
	private function publish_container( $user_id, $access_token, $container_id ) {
		$url = sprintf(
			'https://graph.facebook.com/%s/%s/media_publish',
			self::API_VERSION,
			$user_id
		);

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 60,
				'body'    => array(
					'creation_id'  => $container_id,
					'access_token' => $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_error',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to publish to Instagram: %s', 'fair-audience' ),
					$response->get_error_message()
				)
			);
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( isset( $data['error'] ) ) {
			$error_message = $data['error']['message'] ?? __( 'Unknown error', 'fair-audience' );
			return new WP_Error(
				'instagram_error',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to publish: %s', 'fair-audience' ),
					$error_message
				)
			);
		}

		if ( empty( $data['id'] ) ) {
			return new WP_Error(
				'invalid_response',
				__( 'Invalid response from Instagram API: no media ID returned.', 'fair-audience' )
			);
		}

		return $data;
	}
}
