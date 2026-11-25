/* Host test of the LED feedback state machine (pico-keys-sdk patch 0007). */
#include <stdio.h>
#include <stdlib.h>
#include "../../pico-keys-sdk/src/led/led_status.h"

static int failures;

static void expect(const char *name, led_status_t *s, led_status_event_t ev, led_feedback_t want) {
    led_feedback_t got = led_status_step(s, ev);
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        failures++;
    }
}

int main(void) {
    led_status_t s;

    led_status_init(&s);
    expect("ok/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("ok/accepted", &s, LED_EV_UP_ACCEPTED, LED_FB_UP_ACCEPTED);
    expect("ok/success", &s, LED_EV_JOB_OK, LED_FB_SUCCESS);
    expect("ok/no-repeat", &s, LED_EV_JOB_OK, LED_FB_NONE);

    expect("fail/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("fail/accepted", &s, LED_EV_UP_ACCEPTED, LED_FB_UP_ACCEPTED);
    expect("fail/failure", &s, LED_EV_JOB_ERROR, LED_FB_FAILURE);

    expect("timeout/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("timeout/timeout", &s, LED_EV_UP_TIMEOUT, LED_FB_TIMEOUT);
    expect("timeout/no-second-failure", &s, LED_EV_JOB_ERROR, LED_FB_NONE);

    expect("cancel/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("cancel/up-cancelled", &s, LED_EV_UP_CANCELLED, LED_FB_CLEAR);
    expect("cancel/job-cancelled", &s, LED_EV_JOB_CANCELLED, LED_FB_CLEAR);
    expect("cancel/late-ok-silent", &s, LED_EV_JOB_OK, LED_FB_NONE);

    expect("cancel2/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("cancel2/accepted", &s, LED_EV_UP_ACCEPTED, LED_FB_UP_ACCEPTED);
    expect("cancel2/job-cancelled", &s, LED_EV_JOB_CANCELLED, LED_FB_CLEAR);
    expect("cancel2/late-ok-silent", &s, LED_EV_JOB_OK, LED_FB_NONE);

    expect("poll/getinfo-ok", &s, LED_EV_JOB_OK, LED_FB_NONE);
    expect("poll/wrong-pin", &s, LED_EV_JOB_ERROR, LED_FB_NONE);

    expect("stale/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
    expect("stale/accepted", &s, LED_EV_UP_ACCEPTED, LED_FB_UP_ACCEPTED);
    expect("stale/init", &s, LED_EV_CHANNEL_RESET, LED_FB_CLEAR);
    expect("stale/late-ok-silent", &s, LED_EV_JOB_OK, LED_FB_NONE);

    for (int i = 0; i < 2; i++) {
        expect("twice/request", &s, LED_EV_UP_REQUEST, LED_FB_CLEAR);
        expect("twice/accepted", &s, LED_EV_UP_ACCEPTED, LED_FB_UP_ACCEPTED);
        expect("twice/success", &s, LED_EV_JOB_OK, LED_FB_SUCCESS);
    }

    if (failures) {
        return EXIT_FAILURE;
    }
    puts("led_status: all cases passed");
    return EXIT_SUCCESS;
}
