import ky from 'ky'

export const api = ky.create({
  prefixUrl: '/api',
  hooks: {
    beforeRequest: [
      (request) => {
        const token = localStorage.getItem('access_token')
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          localStorage.removeItem('access_token')
          window.location.href = '/app/login'
        }
        return response
      },
    ],
  },
})
